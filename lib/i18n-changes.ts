/**
 * Which parts of the page the translator has to read again after the page changed.
 *
 * The page renders Chinese and components/LanguageSwitcher.tsx swaps its text in place. It used to walk
 * the whole document after every change, and the header clock changes a text node every second. This
 * keeps only what the changes touched: text nodes whose characters changed, subtrees that were added,
 * and elements whose placeholder, aria-label or title changed.
 *
 * Changes are collected until the next frame. A tab in the background gets no frames, so the sets are
 * bounded: past `limit` entries they are dropped and one walk of the whole page is asked for instead.
 */
const textNode = 3;
const elementNode = 1;

/** As much of a DOM node as is read here (so the tests can pass plain objects). */
export type ChangedNode = { readonly nodeType: number; readonly isConnected?: boolean };
export type PageChange<N extends ChangedNode = ChangedNode> = {
  readonly type: string;
  readonly target: N;
  readonly addedNodes?: ArrayLike<N>;
};
export type PendingTargets<N extends ChangedNode = ChangedNode> = {
  /** Too much changed to list: translate the whole page. The lists are empty. */
  whole: boolean;
  texts: N[];
  subtrees: N[];
  attributes: N[];
};

export function createPendingChanges<N extends ChangedNode = ChangedNode>(limit = 2000) {
  let whole = false;
  const texts = new Set<N>();
  const subtrees = new Set<N>();
  const attributes = new Set<N>();

  return {
    add(changes: Iterable<PageChange<N>>) {
      if (whole) return;
      for (const change of changes) {
        if (change.type === 'characterData') {
          if (change.target.nodeType === textNode) texts.add(change.target);
        } else if (change.type === 'attributes') {
          if (change.target.nodeType === elementNode) attributes.add(change.target);
        } else if (change.type === 'childList') {
          const added = change.addedNodes;
          for (let index = 0; index < (added?.length ?? 0); index += 1) {
            const node = (added as ArrayLike<N>)[index];
            if (node.nodeType === textNode) texts.add(node);
            else if (node.nodeType === elementNode) subtrees.add(node);
          }
        }
      }
      if (texts.size + subtrees.size + attributes.size > limit) {
        whole = true;
        texts.clear();
        subtrees.clear();
        attributes.clear();
      }
    },
    /** What to translate now (nodes since removed from the page are left out); starts over afterwards. */
    take(): PendingTargets<N> {
      const onPage = (node: N) => node.isConnected !== false;
      const taken = { whole, texts: [...texts].filter(onPage), subtrees: [...subtrees].filter(onPage), attributes: [...attributes].filter(onPage) };
      whole = false;
      texts.clear();
      subtrees.clear();
      attributes.clear();
      return taken;
    },
  };
}
