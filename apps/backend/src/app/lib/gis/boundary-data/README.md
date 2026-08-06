# Published boundary data

**This directory is empty of data, and no published boundary file ships in the container image.**
That is by design and did not change when the published-map catalog was added: files are fetched
from blob storage on demand, so a workspace that adds the Ontario map causes the Ontario file to be
downloaded once per process, and a workspace that adds nothing causes no download at all. Putting
every province's and state's file in the image would make every deployment carry tens of megabytes
that most workspaces never read.

This directory is still the first place a file is looked for, which is what makes local development
and a mounted volume work. Drop a `<slug>.geojson` here and it is used in preference to storage.

## Where a published map comes from

A workspace picks an entry from the catalog in `libs/common/src/lib/boundaries/catalog/`. That writes
one `boundary_sets` row with `source = 'bundled'` and the catalog slug. The polygons are never copied
into the database — `apps/backend/src/app/lib/gis/boundary-store.ts` loads the file the slug names and
shares one parsed copy across every workspace that added the same map.

**The catalog is empty in this release.** The mechanism is complete and is exercised the moment an
entry and its file exist. Nothing has been converted yet, for two reasons that are work rather than
unknowns: each publisher's licence has to be read and confirmed to permit redistribution, and the
converted files have to be uploaded. No coordinates have been invented in the meantime.

## The file format

One GeoJSON `FeatureCollection` per catalog entry, in a file named `<slug>.geojson`. Each area's name
and code are read from the properties named by the catalog entry's `nameProperty` and `codeProperty`.
The conversion script always renames the publisher's own property names to `name` and `code`, so the
loader never has to know what the publisher called them. Only `Polygon` and `MultiPolygon` geometries
are read; anything else is skipped with a warning.

Every file must satisfy the same caps an uploaded file must satisfy — 20 MB, 5,000 areas, 50,000
points per area. A file a workspace could not have uploaded is not one this product may publish.

## Where a file is looked for, in order

1. the directory named by the `GIS_BOUNDARY_DATA_DIR` environment variable, if set;
2. `gis-boundaries/` next to the running bundle — where `apps/backend/project.json` copies `*.geojson`
   from this directory;
3. this directory, for tests and for running from source;
4. blob storage, under the reserved `catalog/boundaries/` prefix.

Whichever step supplies the bytes, they are checked against the SHA-256 the catalog records before
they are parsed. A local file that fails the check is skipped and the next source is tried; a stored
file that fails it is refused outright.

**A file that cannot be read at all is not the same as a map with no areas.** The loader omits such a
layer from its result rather than returning it empty, and the matcher only clears household rows for
layers it actually loaded. Without that, one failed download would erase every household's riding
across every workspace holding that map.

## Building and publishing a file

`npm run boundary-catalog -- build | validate | upload`, with its input in
`scripts/boundary-catalog-sources.ts`. The script downloads the publisher's file, reprojects it to
WGS84, strips it to a name and a code, simplifies it only as far as the caps require, and records the
resulting counts and checksum in the generated catalog. It refuses any source whose `licenceVerified`
flag is false.

## What used to be here

`apps/backend/src/app/lib/gis/boundaries.geojson` was 1,314 bytes containing three axis-aligned
rectangles over downtown Chicago, labelled "Ward 1", "Ward 2" and "Ward 3". It was placeholder
scaffolding that never functioned: any address outside those three boxes resolved to nulls, the file
was never copied into a deployed build, and the loader resolved a source-tree path from the process
working directory and silently returned an empty collection when it failed. It has been deleted, and
nothing references it. The checksum gate above exists partly so that a file nobody can vouch for
cannot quietly take its place.

## What would go here

The publishers whose files the catalog is intended to cover, none of which has been ingested:

| Layer                                               | Publisher                                        |
| --------------------------------------------------- | ------------------------------------------------ |
| Canadian federal ridings, 2023 representation order | Elections Canada                                 |
| Canadian provincial ridings                         | One electoral boundaries commission per province |
| US congressional districts                          | US Census Bureau TIGER/Line                      |
| US state legislative districts, per chamber         | US Census Bureau TIGER/Line (SLDU and SLDL)      |

Municipal wards are deliberately absent: there are thousands of publishers with no common format and
many publish only a PDF, so uploading and drawing remain the right paths there. US voting districts
(precincts) are also absent: a single state's precinct file exceeds the 5,000-area cap, and Census
voting-district data is a decennial snapshot that goes stale between censuses, which is why importing
precinct names from a voter file beats publishing them.
