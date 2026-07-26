import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../auth/auth-service';
import { GoLiveService, type GoLiveStepId } from '../go-live/go-live.service';
import { GettingStartedCard } from './getting-started-card';

describe('GettingStartedCard', () => {
  let fixture: ComponentFixture<GettingStartedCard>;
  let userSignal: ReturnType<typeof signal<{ tenant_demo_mode_at: Date | null } | null>>;
  let outstanding: ReturnType<typeof signal<GoLiveStepId[]>>;
  let state: ReturnType<typeof signal<{ deferred: GoLiveStepId[] }>>;
  let load: ReturnType<typeof vi.fn>;

  const text = (): string => fixture.nativeElement.textContent as string;

  beforeEach(async () => {
    userSignal = signal<{ tenant_demo_mode_at: Date | null } | null>({ tenant_demo_mode_at: null });
    outstanding = signal<GoLiveStepId[]>(['organization', 'sending']);
    state = signal<{ deferred: GoLiveStepId[] }>({ deferred: [] });
    load = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [GettingStartedCard],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { getUserSignal: () => userSignal } },
        { provide: GoLiveService, useValue: { outstanding, state, load } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GettingStartedCard);
    fixture.detectChanges();
  });

  it('lists what is still outstanding, with a count and a way in', () => {
    expect(text()).toContain('2 left');
    expect(text()).toContain('Add your mailing address');
    expect(text()).toContain('Set up sending');
    expect(fixture.nativeElement.querySelector('a[href="/go-live"]')).not.toBeNull();
  });

  /** Every item is a real blocker, so each one says what it costs to leave undone. */
  it('says why each item matters', () => {
    expect(text()).toContain('Required by law in every newsletter footer');
    expect(text()).toContain('Newsletters stay locked until this is done');
  });

  it('marks a deliberately deferred item as saved for later', () => {
    state.set({ deferred: ['sending'] });
    fixture.detectChanges();

    expect(text()).toContain('You saved this for later.');
  });

  it('disappears once nothing is outstanding', () => {
    outstanding.set([]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  /**
   * The demo card already owns this conversation while the sample data is present, and the
   * seeded records would make the list read wrong anyway.
   */
  it('stays hidden during demo mode', () => {
    userSignal.set({ tenant_demo_mode_at: new Date() });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('reloads when the demo flag clears, so it reflects the emptied workspace', () => {
    load.mockClear();
    userSignal.set({ tenant_demo_mode_at: new Date() });
    fixture.detectChanges();
    expect(load).not.toHaveBeenCalled();

    userSignal.set({ tenant_demo_mode_at: null });
    fixture.detectChanges();
    expect(load).toHaveBeenCalled();
  });
});
