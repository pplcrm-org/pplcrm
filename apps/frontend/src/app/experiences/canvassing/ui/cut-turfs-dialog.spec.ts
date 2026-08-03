import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ListsService } from '@experiences/lists/services/lists-service';

import { CanvassingService } from '../services/canvassing-service';
import { CutTurfsDialog } from './cut-turfs-dialog';

describe('CutTurfsDialog', () => {
  let component: CutTurfsDialog;
  let fixture: ComponentFixture<CutTurfsDialog>;
  let mockLists: { getAllWithCounts: ReturnType<typeof vi.fn> };
  let mockCanvassing: {
    cutTurfs: ReturnType<typeof vi.fn>;
    previewCut: ReturnType<typeof vi.fn>;
    workspaceHasBoundaryMap: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockLists = {
      // The real shape lists.getAllWithCounts returns: the people_count /
      // household_count aggregates are already collapsed into list_size.
      getAllWithCounts: vi.fn().mockResolvedValue({
        rows: [
          { id: '1', name: 'All Subscribers', object: 'people', is_dynamic: true, list_size: 35 },
          { id: '2', name: 'Doors on Main', object: 'households', is_dynamic: false, list_size: 12 },
        ],
        count: 2,
      }),
    };

    mockCanvassing = {
      cutTurfs: vi.fn(),
      previewCut: vi.fn(),
      workspaceHasBoundaryMap: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [CutTurfsDialog],
      providers: [
        provideRouter([]),
        { provide: ListsService, useValue: mockLists },
        { provide: CanvassingService, useValue: mockCanvassing },
        { provide: AlertService, useValue: { showError: vi.fn(), showSuccess: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CutTurfsDialog);
    component = fixture.componentInstance;
  });

  it('reads the member count from list_size for both people and household lists', async () => {
    await component['loadUniverses']();

    expect(component['universes']()).toEqual([
      { id: '1', name: 'All Subscribers', count: 35, is_dynamic: true },
      { id: '2', name: 'Doors on Main', count: 12, is_dynamic: false },
    ]);
  });

  describe('whether the workspace has a boundary map', () => {
    it('records that there is none, so the dialog can say what happens instead', async () => {
      mockCanvassing.workspaceHasBoundaryMap.mockResolvedValue(false);

      await component['loadBoundaryState']();

      expect(component['hasBoundaryMap']()).toBe(false);
    });

    it('records that there is one', async () => {
      await component['loadBoundaryState']();

      expect(component['hasBoundaryMap']()).toBe(true);
    });

    it('leaves the answer unknown when the read fails, rather than claiming there is no map', async () => {
      mockCanvassing.workspaceHasBoundaryMap.mockRejectedValue(new Error('offline'));

      await component['loadBoundaryState']();

      expect(component['hasBoundaryMap']()).toBeNull();
    });
  });

  describe('what the preview promises about boundary lines', () => {
    const enginePreview = { doors: 12, unplaced: 0, turfCount: 2, avgDoorsPerTurf: 6 };

    /**
     * Render the preview with the server's per-cut `bounded` answer and the workspace map
     * state pinned. The copy must follow `bounded` — whether any map EXISTS proves nothing
     * about whether one applies to this campaign's office.
     */
    async function renderedText(opts: { bounded: boolean; hasMap: boolean | null }): Promise<string> {
      if (opts.hasMap == null) mockCanvassing.workspaceHasBoundaryMap.mockRejectedValue(new Error('offline'));
      else mockCanvassing.workspaceHasBoundaryMap.mockResolvedValue(opts.hasMap);
      mockCanvassing.previewCut.mockResolvedValue({ ...enginePreview, bounded: opts.bounded });
      component['hasBoundaryMap'].set(opts.hasMap);
      component['selectedListId'].set('2');
      await component['refreshPreview']();
      fixture.detectChanges();
      return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
    }

    it('promises that a turf never crosses a boundary line only when THIS cut resolved a map', async () => {
      const text = await renderedText({ bounded: true, hasMap: true });

      expect(text).toContain('never crosses a boundary line');
    });

    it('says the map does not apply to this campaign when maps exist but the cut is unbounded', async () => {
      const text = await renderedText({ bounded: false, hasMap: true });

      expect(text).toContain('does not apply to this campaign');
      expect(text).not.toContain('never crosses a boundary line');
    });

    it('keeps the plain no-map wording when the workspace holds no maps at all', async () => {
      const text = await renderedText({ bounded: false, hasMap: false });

      expect(text).toContain('with no boundary map');
      expect(text).not.toContain('never crosses a boundary line');
      expect(text).not.toContain('does not apply to this campaign');
    });

    it('claims neither story it cannot prove when the workspace map read failed', async () => {
      const text = await renderedText({ bounded: false, hasMap: null });

      expect(text).not.toContain('never crosses a boundary line');
      expect(text).not.toContain('does not apply to this campaign');
    });
  });
});
