import { describe, expect, it } from 'vitest';

import {
  articlesInCategory,
  categoryNeighbors,
  getHelpArticle,
  HELP_ARTICLES,
  HELP_CATEGORIES,
  POPULAR_ARTICLE_IDS,
  relatedArticles,
} from './help-content';
import { parseHelpInline } from './help-types';

import type { HelpArticle, HelpBlock } from './help-types';

/** Routes that exist in dashboard.routes.ts and may be linked from articles. */
const KNOWN_APP_ROUTES = new Set([
  '/dashboard',
  '/go-live',
  '/inbox',
  '/newsletters',
  '/lists',
  '/automations',
  '/people',
  '/households',
  '/companies',
  '/duplicates',
  '/campaigns',
  '/teams',
  '/canvassing',
  '/volunteer-access',
  '/deliveries',
  '/deliveries/plan',
  '/deliveries/routes',
  '/donations',
  '/forms',
  '/tasks',
  '/tasks/board',
  '/board',
  '/workspace/storage',
  '/workspace/billing',
  '/workspace/donations',
  '/workspace/campaigns',
  '/imports',
  '/imports/new',
  '/exports',
  '/activity',
  '/tags',
  '/issues',
  '/users',
  '/workspace',
  '/settings',
  '/profile',
  '/help',
]);

function inlineTexts(block: HelpBlock): string[] {
  switch (block.kind) {
    case 'p':
    case 'h2':
      return [block.text];
    case 'list':
      return block.items;
    case 'steps':
      return block.items.flatMap((s) => (s.detail ? [s.title, s.detail] : [s.title]));
    case 'callout':
      return [block.title, block.text];
    case 'keys':
      return block.rows.map((r) => r.action);
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

function articleLinks(article: HelpArticle): string[] {
  return article.blocks
    .flatMap(inlineTexts)
    .flatMap(parseHelpInline)
    .filter((seg) => seg.kind === 'link')
    .map((seg) => seg.route ?? '');
}

describe('help content integrity', () => {
  it('has unique article ids', () => {
    const ids = HELP_ARTICLES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every article to a defined category', () => {
    const categoryIds = new Set(HELP_CATEGORIES.map((c) => c.id));
    for (const article of HELP_ARTICLES) {
      expect(categoryIds.has(article.category), `${article.id} has unknown category`).toBe(true);
    }
  });

  it('leaves no category empty', () => {
    for (const category of HELP_CATEGORIES) {
      expect(articlesInCategory(category.id).length, `${category.id} is empty`).toBeGreaterThan(0);
    }
  });

  it('only relates articles that exist, never itself', () => {
    for (const article of HELP_ARTICLES) {
      for (const rel of article.related ?? []) {
        expect(getHelpArticle(rel), `${article.id} relates to missing ${rel}`).toBeDefined();
        expect(rel, `${article.id} relates to itself`).not.toBe(article.id);
      }
    }
  });

  it('keeps every internal link pointing at a real route or article', () => {
    for (const article of HELP_ARTICLES) {
      for (const route of articleLinks(article)) {
        if (route.startsWith('/help/')) {
          const target = route.slice('/help/'.length);
          expect(getHelpArticle(target), `${article.id} links to missing article ${route}`).toBeDefined();
        } else {
          expect(KNOWN_APP_ROUTES.has(route), `${article.id} links to unknown route ${route}`).toBe(true);
        }
      }
    }
  });

  it('gives every h2 a unique anchor id within its article', () => {
    for (const article of HELP_ARTICLES) {
      const anchors = article.blocks.filter((b) => b.kind === 'h2').map((b) => b.id);
      expect(new Set(anchors).size, `${article.id} repeats an h2 id`).toBe(anchors.length);
    }
  });

  it('lists only existing articles as popular', () => {
    for (const id of POPULAR_ARTICLE_IDS) {
      expect(getHelpArticle(id), `popular id ${id} missing`).toBeDefined();
    }
  });
});

describe('relatedArticles', () => {
  it('caps results and excludes the article itself', () => {
    for (const article of HELP_ARTICLES) {
      const related = relatedArticles(article);
      expect(related.length).toBeLessThanOrEqual(3);
      expect(related.some((r) => r.id === article.id)).toBe(false);
      expect(new Set(related.map((r) => r.id)).size).toBe(related.length);
    }
  });
});

describe('categoryNeighbors', () => {
  it('walks a category in display order', () => {
    const siblings = articlesInCategory('getting-started');
    expect(siblings.length).toBeGreaterThan(1);

    const first = categoryNeighbors(siblings[0]);
    expect(first.prev).toBeUndefined();
    expect(first.next?.id).toBe(siblings[1].id);

    const last = categoryNeighbors(siblings[siblings.length - 1]);
    expect(last.next).toBeUndefined();
    expect(last.prev?.id).toBe(siblings[siblings.length - 2].id);
  });

  it('returns no neighbors for an article outside its category list', () => {
    const stray = { ...HELP_ARTICLES[0], id: 'not-a-real-article' };
    expect(categoryNeighbors(stray)).toEqual({});
  });
});

describe('relatedArticles hand-picked ordering', () => {
  it('lists the hand-picked related ids first, in order', () => {
    const withRelated = HELP_ARTICLES.find((a) => (a.related ?? []).length > 0);
    if (!withRelated) throw new Error('expected at least one article with hand-picked related ids');

    const result = relatedArticles(withRelated, 3);
    const expectedFirst = (withRelated.related ?? []).slice(0, 3);

    expect(result.slice(0, expectedFirst.length).map((a) => a.id)).toEqual(expectedFirst);
    expect(result.some((a) => a.id === withRelated.id)).toBe(false);
  });

  it('tops up with same-category neighbors when the limit allows', () => {
    const withRelated = HELP_ARTICLES.find((a) => (a.related ?? []).length > 0);
    if (!withRelated) throw new Error('expected at least one article with hand-picked related ids');

    const generous = relatedArticles(withRelated, 100);
    const handPicked = new Set(withRelated.related ?? []);
    const toppedUp = generous.filter((a) => !handPicked.has(a.id));

    // every top-up entry comes from the article's own category, deduped
    expect(toppedUp.every((a) => a.category === withRelated.category)).toBe(true);
    expect(new Set(generous.map((a) => a.id)).size).toBe(generous.length);
  });
});
