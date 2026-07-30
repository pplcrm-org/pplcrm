import { describe, expect, it } from 'vitest';

import { getHelpArticle } from '@common';

import { HELP_DOOR_ARTICLE_IDS, helpArticleForRoute } from './help-doors';

describe('help doors', () => {
  it('points every door at an article that exists', () => {
    const dead = HELP_DOOR_ARTICLE_IDS.filter((id) => getHelpArticle(id) === undefined);
    expect(dead).toEqual([]);
  });

  it('reads the section from the first URL segment', () => {
    expect(helpArticleForRoute('/canvassing')).toBe('canvassing');
    expect(helpArticleForRoute('/canvassing/12')).toBe('canvassing');
    expect(helpArticleForRoute('/people/42/edit')).toBe('add-people');
  });

  it('ignores query strings and fragments', () => {
    expect(helpArticleForRoute('/lists?filter=smart#top')).toBe('lists');
  });

  it('returns an empty id for a section with no guide', () => {
    expect(helpArticleForRoute('/go-live')).toBe('');
    expect(helpArticleForRoute('/')).toBe('');
  });
});
