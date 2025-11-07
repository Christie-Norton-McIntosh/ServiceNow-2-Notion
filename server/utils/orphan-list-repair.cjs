'use strict';

const DEFAULT_SCOPE_SELECTOR = '.zDocsTopicPageBody';
const INDENT_BASE_PX = 24;

const DEFAULT_OPTIONS = {
  scope: null,
  scopeSelector: DEFAULT_SCOPE_SELECTOR,
  verbose: false,
};

function repairListStructure($, options = {}) {
  if (!$ || typeof $.root !== 'function') {
    throw new Error('repairListStructure requires a Cheerio instance.');
  }

  const settings = { ...DEFAULT_OPTIONS, ...options };
  const $scope = resolveScope($, settings);

  const entries = collectListEntries($, $scope);
  const state = {
    timeline: [],
    createdLists: [],
    reattached: [],
    unresolved: [],
    verbose: settings.verbose,
  };

  entries.forEach(entry => {
    entry.repairReason = null;
    entry.wasReattached = false;
    entry.$list = entry.parentList && entry.parentList.length > 0 ? entry.parentList : null;
    entry.finalDepth = entry.actualDepth;

    const requiresRepair = entry.isOrphan || entry.needsDepthFix;

    if (!requiresRepair) {
      state.timeline.push(entry);
      return;
    }

    entry.repairReason = entry.isOrphan ? 'orphan' : 'misnested';

    const repaired = reattachEntry($, entry, state);
    if (!repaired) {
      entry.finalDepth = computeActualDepth(entry.$node);
      if (!entry.$list || entry.$list.length === 0) {
        entry.$list = entry.parentList && entry.parentList.length > 0 ? entry.parentList : entry.$list;
      }
      state.unresolved.push(entry);
    }

    state.timeline.push(entry);
  });

  const misnestedEntries = entries.filter(item => item.needsDepthFix);

  return {
    scope: describeScope($scope),
    totalListItems: entries.length,
    orphanCount: entries.filter(item => item.isOrphan).length,
    misnestedCount: misnestedEntries.length,
    repairedCount: state.reattached.length,
    misnestedRepairedCount: state.reattached.filter(item => item.repairReason === 'misnested').length,
    unresolvedCount: state.unresolved.length,
    misnestedUnresolvedCount: misnestedEntries.filter(item => !item.wasReattached).length,
    createdListCount: state.createdLists.length,
    unresolved: state.unresolved.map(entry => ({
      textPreview: getNodePreview(entry.$node),
      targetDepth: entry.targetDepth,
      depthHint: entry.depthHint,
      listType: entry.listType,
      reason: entry.repairReason || (entry.isOrphan ? 'orphan' : entry.needsDepthFix ? 'misnested' : 'unknown'),
      actualDepth: entry.actualDepth,
    })),
  };
}

function detectOrphanLis($, options = {}) {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const $scope = resolveScope($, settings);
  const orphans = [];

  $scope.find('li').each((_, li) => {
    const $li = $(li);
    if ($li.closest('ol, ul').length === 0) {
      orphans.push(li);
    }
  });

  return orphans;
}

function collectListEntries($, $scope) {
  const entries = [];

  $scope.find('li').each((index, li) => {
    const $li = $(li);
    const parentList = $li.closest('ol, ul');
    const actualDepth = computeActualDepth($li);
    const depthHintInfo = inferDepthHint($li);
    const listType = inferListType($li, parentList);
    let contextDepthHint = null;
    if (parentList && parentList.length > 0) {
      const listClassAttr = (parentList.attr('class') || '').toLowerCase();
      const listIdAttr = (parentList.attr('id') || '').toLowerCase();
      if (/substeps?/.test(listClassAttr) || /substeps?/.test(listIdAttr)) {
        contextDepthHint = takeMaxDepth(contextDepthHint, 2);
        console.log(`[LIST-REPAIR] Parent list ID "${listIdAttr}" class "${listClassAttr}" triggers contextDepthHint=2 for li: "${getNodePreview($li)}"`);
      }
      if (/subsubsteps?/.test(listClassAttr) || /subsubsteps?/.test(listIdAttr)) {
        contextDepthHint = takeMaxDepth(contextDepthHint, 3);
      }
    }

    const targetDepth = determineTargetDepth(actualDepth, depthHintInfo.depth, contextDepthHint);
    const needsDepthFix = parentList.length > 0 && targetDepth > actualDepth;

    if (needsDepthFix || contextDepthHint) {
      console.log(`[LIST-REPAIR] Entry ${index}: actualDepth=${actualDepth}, targetDepth=${targetDepth}, contextHint=${contextDepthHint}, needsFix=${needsDepthFix}, text="${getNodePreview($li)}"`);
      if (parentList && parentList.length > 0) {
        const parentId = parentList.attr('id') || 'no-id';
        const parentClass = parentList.attr('class') || 'no-class';
        console.log(`[LIST-REPAIR] Parent list: id="${parentId}" class="${parentClass}"`);
      }
    }

    entries.push({
      index,
      node: li,
      $node: $li,
      parentList: parentList.length > 0 ? parentList : null,
      actualDepth,
      isOrphan: parentList.length === 0,
      depthHint: depthHintInfo.depth,
      depthHintSources: depthHintInfo.sources,
      listType,
      targetDepth,
      finalDepth: actualDepth,
      $list: parentList.length > 0 ? parentList : null,
      needsDepthFix,
    });
  });

  return entries;
}

function reattachEntry($, entry, state) {
  const targetDepth = Math.max(1, entry.targetDepth || 1);
  const listType = entry.listType;

  const parentEntry = targetDepth > 1
    ? findLatestTimelineEntry(state.timeline, candidate => candidate.finalDepth === targetDepth - 1)
    : null;

  let destination = null;
  let anchorEntry = null;

  if (parentEntry) {
    const nestedList = ensureNestedList($, parentEntry, listType, state);
    if (nestedList) {
      destination = nestedList;
      anchorEntry = findLatestTimelineEntry(state.timeline, candidate => candidate.finalDepth === targetDepth && candidate.$list && candidate.$list.get(0) === nestedList.get(0));
      if (anchorEntry) {
        anchorEntry.$node.after(entry.$node);
      } else {
        nestedList.append(entry.$node);
      }
    }
  }

  if (!destination) {
    anchorEntry = findLatestTimelineEntry(state.timeline, candidate => candidate.finalDepth === targetDepth && candidate.$list);
    if (anchorEntry && anchorEntry.$list) {
      destination = anchorEntry.$list;
      anchorEntry.$node.after(entry.$node);
    }
  }

  if (!destination) {
    const nearbyList = findNearbyList($, entry.$node, listType);
    if (nearbyList) {
      destination = nearbyList.$list;
      if (nearbyList.anchor) {
        nearbyList.anchor.after(entry.$node);
      } else if (nearbyList.origin === 'prepend') {
        destination.prepend(entry.$node);
      } else {
        destination.append(entry.$node);
      }
    }
  }

  if (!destination) {
    destination = createAutoListAtLocation($, entry, state);
  }

  if (!destination) {
    return false;
  }

  entry.$list = destination;
  entry.finalDepth = computeActualDepth(entry.$node);
  entry.wasReattached = true;
  state.reattached.push(entry);

  return true;
}

function ensureNestedList($, parentEntry, listType, state) {
  if (!parentEntry || !parentEntry.$node) {
    return null;
  }

  const $parentLi = parentEntry.$node;
  const selector = listType === 'ul' ? '> ul' : '> ol';
  let nested = $parentLi.children(selector).filter((_, el) => isListOfType(el, listType)).first();

  if (!nested || nested.length === 0) {
    nested = $(`<${listType}></${listType}>`);
    nested.addClass('sn2n-generated-list');
    nested.attr('data-sn2n-source', 'orphan-repair');
    $parentLi.append(nested);
    state.createdLists.push(nested);

    if (state.verbose) {
      console.log(`[LIST-REPAIR] Created nested <${listType}> under "${getNodePreview($parentLi)}".`);
    }
  }

  return nested;
}

function createAutoListAtLocation($, entry, state) {
  const listType = entry.listType;
  const $li = entry.$node;
  const $parent = $li.parent();
  const generated = $(`<${listType}></${listType}>`);

  generated.addClass('sn2n-generated-list');
  generated.attr('data-sn2n-source', 'orphan-repair');

  if ($parent && $parent.length > 0) {
    generated.insertBefore($li);
  } else {
    $.root().append(generated);
  }

  generated.append($li);
  state.createdLists.push(generated);

  if (state.verbose) {
    console.log(`[LIST-REPAIR] Created standalone <${listType}> for orphan "${getNodePreview($li)}".`);
  }

  return generated;
}

function findNearbyList($, $li, listType) {
  let $cursor = $li;

  while ($cursor && $cursor.length > 0) {
    const prevExact = $cursor.prevAll(listType).first();
    if (prevExact && prevExact.length > 0) {
      return { $list: prevExact, origin: 'append' };
    }

    const prevAny = $cursor.prevAll('ol, ul').first();
    if (prevAny && prevAny.length > 0) {
      return { $list: prevAny, origin: 'append' };
    }

    $cursor = $cursor.parent();
  }

  $cursor = $li;

  while ($cursor && $cursor.length > 0) {
    const prevLi = $cursor.prevAll('li').first();
    if (prevLi && prevLi.length > 0) {
      const parentList = prevLi.closest('ol, ul');
      if (parentList && parentList.length > 0) {
        return { $list: parentList, origin: 'after', anchor: prevLi };
      }
    }

    $cursor = $cursor.parent();
  }

  $cursor = $li;

  while ($cursor && $cursor.length > 0) {
    const nextExact = $cursor.nextAll(listType).first();
    if (nextExact && nextExact.length > 0) {
      return { $list: nextExact, origin: 'prepend' };
    }

    const nextAny = $cursor.nextAll('ol, ul').first();
    if (nextAny && nextAny.length > 0) {
      return { $list: nextAny, origin: 'prepend' };
    }

    $cursor = $cursor.parent();
  }

  return null;
}

function determineTargetDepth(actualDepth, depthHint, contextHint) {
  const normalizedActual = actualDepth || 0;
  const hintValues = [depthHint, contextHint].filter(value => value && value > 0);
  const strongestHint = hintValues.length > 0 ? Math.max(...hintValues) : null;

  if (strongestHint && strongestHint > normalizedActual) {
    return strongestHint;
  }

  if (normalizedActual > 0) {
    return normalizedActual;
  }

  if (strongestHint && strongestHint > 0) {
    return strongestHint;
  }

  return 1;
}

function computeActualDepth($li) {
  let depth = 0;
  let $walker = $li.parent();

  while ($walker && $walker.length > 0) {
    if (isListNode($walker)) {
      depth += 1;
    }
    $walker = $walker.parent();
  }

  return depth;
}

function inferDepthHint($li) {
  const result = { depth: null, sources: [] };
  const classAttr = ($li.attr('class') || '').trim();

  if (classAttr) {
    if (/\bsubsubsteps?\b/i.test(classAttr)) {
      result.depth = takeMaxDepth(result.depth, 3);
      result.sources.push('class:subsubstep');
    }
    if (/\bsubsteps?\b/i.test(classAttr)) {
      result.depth = takeMaxDepth(result.depth, 2);
      result.sources.push('class:substep');
    }

    const levelMatch = classAttr.match(/\blevel[-_]?([0-9]+)\b/i);
    if (levelMatch) {
      const value = parseInt(levelMatch[1], 10);
      if (!Number.isNaN(value)) {
        result.depth = takeMaxDepth(result.depth, value);
        result.sources.push(`class:level-${value}`);
      }
    }

    const lvlMatch = classAttr.match(/\blvl([0-9]+)\b/i);
    if (lvlMatch) {
      const value = parseInt(lvlMatch[1], 10);
      if (!Number.isNaN(value)) {
        result.depth = takeMaxDepth(result.depth, value);
        result.sources.push(`class:lvl${value}`);
      }
    }
  }

  const attrKeys = ['data-level', 'data-indent-level', 'data-depth', 'data-list-level', 'aria-level'];
  attrKeys.forEach(key => {
    const raw = $li.attr(key);
    if (raw) {
      const value = parseInt(raw, 10);
      if (!Number.isNaN(value)) {
        result.depth = takeMaxDepth(result.depth, value);
        result.sources.push(`${key}:${value}`);
      }
    }
  });

  const styleAttr = $li.attr('style') || '';
  if (styleAttr) {
    const indentMatch = styleAttr.match(/(?:margin|padding|text-indent|--indent)[^:]*:\s*([0-9.]+)\s*(px|rem|em)/i);
    if (indentMatch) {
      const magnitude = parseFloat(indentMatch[1]);
      const unit = indentMatch[2].toLowerCase();
      if (!Number.isNaN(magnitude)) {
        const px = convertIndentToPx(magnitude, unit);
        if (px > 0) {
          const derivedDepth = Math.max(1, Math.round(px / INDENT_BASE_PX) + 1);
          result.depth = takeMaxDepth(result.depth, derivedDepth);
          result.sources.push(`style-indented:${px.toFixed(1)}px`);
        }
      }
    }
  }

  return result;
}

function inferListType($li, parentList) {
  if (parentList && parentList.length > 0) {
    return parentList.get(0).name === 'ul' ? 'ul' : 'ol';
  }

  const attrValue = ($li.attr('data-list-type') || '').toLowerCase();
  if (attrValue.includes('unordered') || attrValue.includes('bullet')) {
    return 'ul';
  }
  if (attrValue.includes('ordered') || attrValue.includes('number')) {
    return 'ol';
  }

  const classAttr = ($li.attr('class') || '').toLowerCase();
  if (/(bullet|unordered|ulist)/.test(classAttr)) {
    return 'ul';
  }
  if (/(step|procedure|ordered|olist|ol)/.test(classAttr)) {
    return 'ol';
  }

  const text = ($li.text() || '').trim();
  if (/^[0-9]+[\.)]/.test(text) || /^[a-z][\.)]/i.test(text)) {
    return 'ol';
  }
  if (/^(?:[-•*]|\u2022)/.test(text)) {
    return 'ul';
  }

  return 'ol';
}

function resolveScope($, options) {
  if (options.scope && options.scope.length > 0) {
    return options.scope;
  }

  if (options.scopeSelector) {
    const $selected = $(options.scopeSelector).first();
    if ($selected && $selected.length > 0) {
      return $selected;
    }
  }

  return $.root();
}

function findLatestTimelineEntry(timeline, predicate) {
  for (let idx = timeline.length - 1; idx >= 0; idx -= 1) {
    const candidate = timeline[idx];
    if (predicate(candidate)) {
      return candidate;
    }
  }
  return null;
}

function isListOfType(node, type) {
  if (!node || !node.name) {
    return false;
  }
  return node.name.toLowerCase() === type;
}

function isListNode($node) {
  if (!$node || $node.length === 0) {
    return false;
  }
  const node = $node.get(0);
  if (!node || !node.name) {
    return false;
  }
  const name = node.name.toLowerCase();
  return name === 'ol' || name === 'ul';
}

function takeMaxDepth(current, candidate) {
  if (!candidate || candidate < 1) {
    return current || null;
  }
  if (!current || candidate > current) {
    return candidate;
  }
  return current;
}

function convertIndentToPx(value, unit) {
  if (unit === 'px') {
    return value;
  }
  if (unit === 'rem' || unit === 'em') {
    return value * 16;
  }
  return value;
}

function getNodePreview($node) {
  if (!$node || $node.length === 0) {
    return '';
  }
  return ($node.text() || '').trim().replace(/\s+/g, ' ').substring(0, 80);
}

function describeScope($scope) {
  if (!$scope || $scope.length === 0) {
    return 'root';
  }

  const el = $scope.get(0);
  const tag = el && el.name ? el.name : 'unknown';
  const id = $scope.attr('id');
  const classAttr = ($scope.attr('class') || '').trim();
  const classTokens = classAttr ? classAttr.split(/\s+/).slice(0, 2).join('.') : '';

  let descriptor = `<${tag}`;
  if (id) {
    descriptor += `#${id}`;
  }
  if (classTokens) {
    descriptor += `.${classTokens}`;
  }
  descriptor += '>';

  return descriptor;
}

module.exports = {
  repairListStructure,
  detectOrphanLis,
  inferDepthHint,
  inferListType,
};
