import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  className = '';
  textContent = '';
  title = '';
  type = '';
  value = '';
  checked = false;
  disabled = false;
  classList = {
    add: () => {},
    remove: () => {},
  };

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  addEventListener(): void {}
}

function collectTextByClass(element: FakeElement, className: string): string[] {
  const matches: string[] = [];
  if (element.className.split(/\s+/).includes(className)) {
    matches.push(element.textContent);
  }
  for (const child of element.children) {
    matches.push(...collectTextByClass(child, className));
  }
  return matches;
}

describe('side panel domain grouping', () => {
  it('keeps exact subdomain schemas visible while collapsing www parent-domain schemas', () => {
    const source = readFileSync(join(process.cwd(), 'extension', 'sidepanel.js'), 'utf-8');
    const start = source.indexOf('function getDomain');
    const end = source.indexOf('/**\n * The footer primary button');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const tabList = new FakeElement('div');
    const context = vm.createContext({
      allTabs: [
        {
          tabId: 1,
          title: 'Gemini',
          url: 'https://gemini.google.com/app/b898ddce83425161',
        },
        {
          tabId: 2,
          title: 'Amazon',
          url: 'https://www.amazon.com/s?k=sardines',
        },
        {
          tabId: 3,
          title: 'Mail',
          url: 'https://mail.google.com/mail/u/0/',
        },
      ],
      selectedIds: new Set(),
      schemaInfo: {
        'gemini.google.com': { variants: [{ name: 'responses', description: '' }] },
        'amazon.com': { variants: [{ name: 'prices', description: '' }] },
      },
      extractionMode: {},
      tabList,
      document: {
        createElement: (tagName: string) => new FakeElement(tagName),
      },
      renderEmptyState: () => {},
      defaultModeFor: () => 'raw',
      persistExtractionMode: () => {},
      updateSaveButton: () => {},
      Event,
      URL,
      Map,
      Set,
      Array,
      Object,
    });

    vm.runInContext(source.slice(start, end) + '\nrenderTabs();', context);

    const labels = collectTextByClass(tabList, 'domain-name');
    expect(labels).toContain('gemini.google.com');
    expect(labels).toContain('amazon.com');
    expect(labels).toContain('mail.google.com');
    expect(labels).not.toContain('google.com');
    expect(labels).not.toContain('www.amazon.com');
  });
});
