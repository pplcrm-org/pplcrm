import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Tags } from './tags';
import { TagsService } from '@experiences/tags/services/tags-service';
import { TagPaletteService } from './tag-palette.service';
import { TagOptionsService } from '@frontend/shared/components/datagrid/services/tag-options.service';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('Tags Component', () => {
  let component: Tags;
  let fixture: ComponentFixture<Tags>;
  let mockTagsService: any;
  let mockPaletteService: any;
  let mockTagOptionsSvc: any;

  beforeEach(async () => {
    mockTagsService = {
      findByName: vi.fn().mockResolvedValue([{ name: 'VIP' }]),
    };

    mockPaletteService = {
      palette: vi.fn().mockReturnValue({ VIP: 'red' }),
      colorFor: vi.fn().mockReturnValue(null),
    };

    mockTagOptionsSvc = {
      invalidate: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [Tags],
      providers: [
        { provide: TagsService, useValue: mockTagsService },
        { provide: TagPaletteService, useValue: mockPaletteService },
        { provide: TagOptionsService, useValue: mockTagOptionsSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Tags);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeDefined();
  });

  it('should initialize and display tags provided via input', () => {
    fixture.componentRef.setInput('tags', ['VIP', 'New']);
    fixture.detectChanges();

    // Verify internal displayTags returns correctly resolved colors
    const views = component['displayTags']();
    expect(views.length).toBe(2);
    expect(views.find((v) => v.name === 'VIP')?.color).toBe('red');
    expect(views.find((v) => v.name === 'New')?.color).toBeNull();
  });

  it('should preserve the parent array order on init (no re-add reversal)', () => {
    fixture.componentRef.setInput('tags', ['A', 'B', 'C']);
    fixture.detectChanges();

    expect(component.tags()).toEqual(['A', 'B', 'C']);
  });

  it('should add a new tag immutably and emit events', () => {
    const parentArr = ['VIP'];
    fixture.componentRef.setInput('tags', parentArr);
    fixture.detectChanges();

    const addSpy = vi.spyOn(component.tagAdded, 'emit');
    const changes: string[][] = [];
    const sub = component.tags.subscribe((v) => changes.push(v));

    // act
    component['add']('NewTag');
    sub.unsubscribe();

    expect(addSpy).toHaveBeenCalledWith('newtag');
    expect(changes).toEqual([['newtag', 'VIP']]);
    expect(component.tags()).toEqual(['newtag', 'VIP']);
    // The parent's array is never mutated in place — a NEW reference is produced,
    // so parent computed()s re-run (the person-form tagSuggestions regression).
    expect(parentArr).toEqual(['VIP']);
  });

  it('should move an existing tag to the front if added again', () => {
    fixture.componentRef.setInput('tags', ['A', 'B', 'C']);
    fixture.detectChanges();

    const addSpy = vi.spyOn(component.tagAdded, 'emit');
    const before = component.tags();

    // act
    component['add']('B');

    // Should not emit tagAdded since it already exists
    expect(addSpy).not.toHaveBeenCalled();
    // But it should move 'B' to the front with a new array reference
    expect(component.tags()).toEqual(['B', 'A', 'C']);
    expect(component.tags()).not.toBe(before);
  });

  it('should remove a tag immutably and emit events', () => {
    const parentArr = ['A', 'B'];
    fixture.componentRef.setInput('tags', parentArr);
    fixture.detectChanges();

    const removeSpy = vi.spyOn(component.tagRemoved, 'emit');
    const changes: string[][] = [];
    const sub = component.tags.subscribe((v) => changes.push(v));

    // act
    component['remove']('A');
    sub.unsubscribe();

    expect(removeSpy).toHaveBeenCalledWith('A');
    expect(changes).toEqual([['B']]);
    expect(component.tags()).toEqual(['B']);
    expect(parentArr).toEqual(['A', 'B']); // input array untouched
  });

  it('should filter suggestions via tags service', async () => {
    fixture.detectChanges();

    const result = await component.filter('VI');
    expect(mockTagsService.findByName).toHaveBeenCalledWith('VI', 'tag');
    expect(result).toEqual(['VIP']);
  });

  it('should gracefully handle empty filters', async () => {
    fixture.detectChanges();
    const result = await component.filter('');
    expect(result).toEqual([]);
    expect(mockTagsService.findByName).not.toHaveBeenCalled();
  });
});
