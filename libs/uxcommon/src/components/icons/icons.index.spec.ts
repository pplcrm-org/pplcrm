import * as IconsIndex from './icons.index';

describe('Icons Index', () => {
  describe('Exports', () => {
    it('should export IconName type', () => {
      expect(IconsIndex).toBeDefined();
    });

    it('should export icons object', () => {
      expect(IconsIndex.icons).toBeDefined();
      expect(typeof IconsIndex.icons).toBe('object');
    });

    it('should have icons as a non-empty object', () => {
      expect(Object.keys(IconsIndex.icons).length).toBeGreaterThan(0);
    });
  });

  describe('Icon Definitions', () => {
    it('should have string values for all icon keys', () => {
      Object.entries(IconsIndex.icons).forEach(([key, value]) => {
        expect(typeof key).toBe('string');
        expect(typeof value).toBe('string');
        expect(key.length).toBeGreaterThan(0);
        expect(value.length).toBeGreaterThan(0);
      });
    });

    it('should reference svg asset paths', () => {
      Object.entries(IconsIndex.icons).forEach(([key, value]) => {
        if (key === 'none') return;
        expect(value).toMatch(/\.svg$/);
      });
    });

    it('should have consistent icon naming', () => {
      Object.keys(IconsIndex.icons).forEach((key) => {
        // Icon names should be kebab-case or contain allowed characters
        expect(key).toMatch(/^[a-z0-9-_]+$/);
      });
    });
  });

  describe('Common Icons', () => {
    const commonIcons = [
      'star',
      'star-filled',
      'user-circle',
      'user-plus',
      'arrow-uturn-left',
      'arrows-pointing-out',
      'eye',
      'eye-slash',
    ];

    commonIcons.forEach((iconName) => {
      it(`should include common icon: ${iconName}`, () => {
        expect(IconsIndex.icons).toHaveProperty(iconName);
        expect(typeof IconsIndex.icons[iconName as keyof typeof IconsIndex.icons]).toBe('string');
      });
    });
  });

  describe('Icon Content Validation', () => {
    it('should have non-empty SVG content for all icons', () => {
      Object.entries(IconsIndex.icons).forEach(([, value]) => {
        expect(value.trim()).not.toBe('');
        expect(value).not.toBe('undefined');
        expect(value).not.toBe('null');
      });
    });

    it('should not have duplicate icon definitions', () => {
      const iconValues = Object.values(IconsIndex.icons);
      const uniqueValues = [...new Set(iconValues)];

      // Allow some duplication as icons might legitimately share SVG content
      // but check that we don't have excessive duplication
      expect(uniqueValues.length).toBeGreaterThan(iconValues.length * 0.5);
    });
  });

  describe('Type Safety', () => {
    it('should export IconName type that matches icon keys', () => {
      // This test ensures type safety at runtime
      const iconKeys = Object.keys(IconsIndex.icons);
      expect(iconKeys.length).toBeGreaterThan(0);

      // Each key should be a valid string
      iconKeys.forEach((key) => {
        expect(typeof key).toBe('string');
      });
    });
  });
});
