# Bundled boundary data

**This directory is empty of data on purpose. No bundled boundary files ship with pplCRM today.**

Every boundary a workspace holds arrives one of three ways: a CSV import that already carries
district columns, an uploaded GeoJSON file, or polygons drawn on the map inside the app. The code
path that reads a bundled file is complete and is exercised the moment a file is placed here — it is
not stubbed — but nothing has been converted yet, and no coordinates have been invented to stand in
for real ones.

## What used to be here

`apps/backend/src/app/lib/gis/boundaries.geojson` was 1,314 bytes containing three axis-aligned
rectangles over downtown Chicago, labelled "Ward 1", "Ward 2" and "Ward 3". It was placeholder
scaffolding that never functioned: any address outside those three boxes resolved to nulls, the file
was never copied into a deployed build, and the loader resolved a source-tree path from the process
working directory and silently returned an empty collection when it failed. It has been deleted, and
nothing references it.

## The file format

One GeoJSON `FeatureCollection` per boundary set, in a file named `<slug>.geojson`, where `<slug>`
is the `slug` column of the `boundary_sets` row. Each feature's name and code are read from the
properties named by that row's `name_property` and `code_property` columns, defaulting to `name` and
`code`. Only `Polygon` and `MultiPolygon` geometries are read; anything else is skipped with a
warning.

## How a file reaches a deployed build

`apps/backend/project.json` copies `**/*.geojson` from this directory to `gis-boundaries/` beside
the built bundle. At runtime `apps/backend/src/app/lib/gis/boundary-store.ts` looks in, in order:

1. the directory named by the `GIS_BOUNDARY_DATA_DIR` environment variable, if set;
2. `gis-boundaries/` next to the running bundle;
3. this directory, for tests and for running from source.

The README itself is not copied — only `*.geojson` files are.

## What would go here

The two authoritative publishers, neither of which has been ingested:

| Layer                                               | Publisher                                          |
| --------------------------------------------------- | -------------------------------------------------- |
| Canadian federal ridings, 2023 representation order | Elections Canada                                   |
| Canadian provincial ridings                         | One electoral boundaries commission per province   |
| US congressional districts                          | US Census Bureau TIGER/Line                        |
| US state legislative districts, per chamber         | US Census Bureau TIGER/Line (SLDU and SLDL)        |
| US voting districts (precincts)                     | US Census Bureau TIGER/Line — a decennial snapshot |

Two things to record on the `boundary_sets` row rather than discover later: Census voting-district
data is a decennial snapshot and goes stale between censuses, which is why `vintage` exists and why
import beats bundling for precincts; and congressional and legislative boundaries change with
redistricting, so a bundled set is versioned and never updated in place.
