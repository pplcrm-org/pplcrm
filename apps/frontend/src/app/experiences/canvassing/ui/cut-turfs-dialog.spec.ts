import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertService } from '@uxcommon/components/alerts/alert-service';
import { ListsService } from '@experiences/lists/services/lists-service';

import { CanvassingService } from '../services/canvassing-service';
import { CutTurfsDialog } from './cut-turfs-dialog';

describe('CutTurfsDialog', () => {
  let component: CutTurfsDialog;
  let fixture: ComponentFixture<CutTurfsDialog>;
  let mockLists: { getAllWithCounts: ReturnType<typeof vi.fn> };

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

    await TestBed.configureTestingModule({
      imports: [CutTurfsDialog],
      providers: [
        { provide: ListsService, useValue: mockLists },
        { provide: CanvassingService, useValue: { previewCut: vi.fn(), cutTurfs: vi.fn() } },
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
});
