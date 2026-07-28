import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { TagItem } from './tagitem';

describe('TagItem', () => {
  let component: TagItem;
  let fixture: ComponentFixture<TagItem>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TagItem],
    }).compileComponents();

    fixture = TestBed.createComponent(TagItem);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('name', 'donor');
    fixture.detectChanges();
  });

  it('capitalizes the first letter of the name for display', () => {
    fixture.componentRef.setInput('name', 'donor');
    fixture.detectChanges();
    const label = fixture.debugElement.query(By.css('.tag-label'));
    expect(label.nativeElement.textContent.trim()).toBe('Donor');
  });

  it('emits click with the raw name when the label is clicked', () => {
    const spy = vi.fn();
    component.tagClicked.subscribe(spy);

    fixture.debugElement.query(By.css('.tag-label')).nativeElement.click();

    expect(spy).toHaveBeenCalledWith('donor');
  });

  it('emits close with the raw name when the remove icon is clicked', () => {
    fixture.componentRef.setInput('canDelete', true);
    fixture.detectChanges();
    const spy = vi.fn();
    component.tagClosed.subscribe(spy);

    fixture.debugElement.query(By.css('.tag-remove')).nativeElement.click();

    expect(spy).toHaveBeenCalledWith('donor');
  });

  it('hides the remove icon when canDelete is false', () => {
    fixture.componentRef.setInput('canDelete', false);
    fixture.detectChanges();
    const icon = fixture.debugElement.query(By.css('.tag-remove'));
    expect(icon.nativeElement.classList.contains('hidden')).toBe(true);
  });

  it('ignores an invalid color and falls back to no background', () => {
    fixture.componentRef.setInput('color', 'not-a-color');
    fixture.detectChanges();
    const badge = fixture.debugElement.query(By.css('.badge'));
    expect(badge.nativeElement.style.background).toBe('');
  });

  it('applies a valid hex color as the background and picks a readable text color', () => {
    // Dark background -> light text
    fixture.componentRef.setInput('color', '#000000');
    fixture.detectChanges();
    const badge = fixture.debugElement.query(By.css('.badge'));
    expect(badge.nativeElement.style.background).toContain('rgb(0, 0, 0)');
    expect(badge.nativeElement.style.color).toBe('rgb(249, 250, 251)');
  });

  it('picks dark text on a light background', () => {
    fixture.componentRef.setInput('color', '#ffffff');
    fixture.detectChanges();
    const badge = fixture.debugElement.query(By.css('.badge'));
    expect(badge.nativeElement.style.color).toBe('rgb(17, 24, 39)');
  });

  it('accepts a 6-digit hex without a leading #', () => {
    fixture.componentRef.setInput('color', 'ff0000');
    fixture.detectChanges();
    const badge = fixture.debugElement.query(By.css('.badge'));
    expect(badge.nativeElement.style.background).toContain('rgb(255, 0, 0)');
  });
});
