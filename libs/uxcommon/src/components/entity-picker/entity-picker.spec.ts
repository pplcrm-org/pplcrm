import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PcPickerOption } from './entity-picker';
import { EntityPicker } from './entity-picker';

const OPTIONS: PcPickerOption[] = [
  { id: '1', label: 'Priya Sharma', hint: 'priya@example.com', badge: 'Captain' },
  { id: '2', label: 'Mai Nguyen', hint: 'mai@example.com' },
  { id: '3', label: 'Jake Moreau', hint: 'jake@example.com' },
];

describe('EntityPicker', () => {
  let component: EntityPicker;
  let fixture: ComponentFixture<EntityPicker>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EntityPicker] }).compileComponents();

    fixture = TestBed.createComponent(EntityPicker);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('label', 'Team volunteers');
    fixture.componentRef.setInput('plural', 'volunteers');
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.detectChanges();
  });

  function rowLabels(): string[] {
    return fixture.debugElement.queryAll(By.css('.pc-picker-row')).map((row) => row.nativeElement.textContent.trim());
  }

  it('renders every option with its hint and badge', () => {
    expect(rowLabels().length).toBe(3);
    const first = fixture.debugElement.queryAll(By.css('.pc-picker-row'))[0].nativeElement.textContent;
    expect(first).toContain('Priya Sharma');
    expect(first).toContain('priya@example.com');
    expect(first).toContain('Captain');
  });

  it('narrates how many of the total are selected', () => {
    fixture.componentRef.setInput('selectedIds', ['1', '3']);
    fixture.detectChanges();

    expect(component['summary']()).toBe('2 of 3 volunteers selected');
  });

  it('shows a chip for each selection as soon as it is ticked', () => {
    component['toggle']('2');
    fixture.detectChanges();

    expect(component.selectedIds()).toEqual(['2']);
    const chips = fixture.debugElement.queryAll(By.css('.badge-primary'));
    expect(chips.length).toBe(1);
    expect(chips[0].nativeElement.textContent).toContain('Mai Nguyen');
  });

  it('removes a selection from its chip and clears them all', () => {
    fixture.componentRef.setInput('selectedIds', ['1', '2']);
    fixture.detectChanges();

    component['deselect']('1');
    expect(component.selectedIds()).toEqual(['2']);

    component['clearAll']();
    expect(component.selectedIds()).toEqual([]);
  });

  it('keeps chip order matching option order, not click order', () => {
    component['toggle']('3');
    component['toggle']('1');
    fixture.detectChanges();

    expect(component['selectedOptions']().map((o) => o.id)).toEqual(['1', '3']);
  });

  it('filters on label and hint, and narrates the narrowed set', () => {
    component['search'].set('mai@');
    fixture.detectChanges();

    expect(rowLabels().length).toBe(1);
    expect(component['summary']()).toBe('0 selected · 1 of 3 shown');
  });

  it('offers a way out when the search matches nothing', () => {
    component['search'].set('zzz');
    fixture.detectChanges();

    expect(rowLabels().length).toBe(0);
    const clear = fixture.debugElement
      .queryAll(By.css('button'))
      .find((b) => b.nativeElement.textContent.includes('Clear search'));
    expect(clear).toBeTruthy();

    clear?.triggerEventHandler('click', null);
    fixture.detectChanges();
    expect(rowLabels().length).toBe(3);
  });

  it('selects only the options the active search shows', () => {
    component['search'].set('a');
    fixture.detectChanges();
    const matching = component['selectableMatches']().map((o) => o.id);

    component['selectAllMatching']();

    expect(component.selectedIds()).toEqual(matching);
  });
});
