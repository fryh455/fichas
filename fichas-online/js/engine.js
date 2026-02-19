/**
 * engine.js é o ÚNICO lugar com:
 * - rolagem d12
 * - build de components
 * - total (autoSum)
 * - rollEvent pronto pra salvar em /rolls
 */

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function rollD12() {
  return 1 + Math.floor(Math.random() * 12);
}

export function buildComponents({ sourceType, sourceData, characterState }) {
  const attrs = characterState?.attributes || {};
  const type = sourceType;

  if (type === "ATTRIBUTE") {
    const k = sourceData?.attrKey;
    const v = safeNum(attrs?.[k], 0);
    return [{ label: `Atributo ${k}`, value: v }];
  }

  if (type === "ADVANTAGE" || type === "DISADVANTAGE") {
    const name = String(sourceData?.name || "");
    const mv = safeNum(sourceData?.modValue, 0);
    const label = (type === "ADVANTAGE") ? `Vantagem ${name}` : `Desvantagem ${name}`;
    return [{ label, value: mv }];
  }

  if (type === "ITEM") {
    const name = String(sourceData?.name || "");
    const base = String(sourceData?.atributoBase || "");
    const baseV = safeNum(attrs?.[base], 0);
    const mv = safeNum(sourceData?.modValue, 0);
    return [
      { label: `Atributo Base ${base}`, value: baseV },
      { label: `Item ${name}`, value: mv }
    ];
  }

  // RAW
  return [];
}

export function resolveRoll({ sourceType, sourceId, sourceName, characterState, autoSum, actor }) {
  const d12 = rollD12();

  // sourceData mínimo para components
  let sourceData = {};
  if (sourceType === "ATTRIBUTE") {
    sourceData = { attrKey: sourceId };
  } else if (sourceType === "ADVANTAGE" || sourceType === "DISADVANTAGE") {
    sourceData = { name: sourceName, modValue: characterState?.advantages?.[sourceId]?.modValue ?? characterState?.disadvantages?.[sourceId]?.modValue ?? 0 };
  } else if (sourceType === "ITEM") {
    const it = characterState?.items?.[sourceId] || {};
    sourceData = { name: it?.name || sourceName, atributoBase: it?.atributoBase, modValue: it?.modValue };
  } else {
    sourceData = {};
  }

  const components = buildComponents({ sourceType, sourceData, characterState });
  const componentsSum = components.reduce((acc, c) => acc + safeNum(c.value, 0), 0);

  const totalFinal = autoSum ? (d12 + componentsSum) : null;

  const rollEvent = {
    uid: actor?.uid || null,
    displayName: actor?.displayName || null,
    role: actor?.role || null,
    charId: actor?.charId || null,

    sourceType,
    sourceId: sourceId || null,
    sourceName: sourceName || null,

    diceRolled: [d12],
    components,
    autoSum: !!autoSum,
    totalFinal,
    playerEnteredTotal: null,
    timestamp: Date.now()
  };

  const uiResult = {
    d12,
    components,
    autoSum: !!autoSum,
    totalFinal
  };

  return { uiResult, rollEvent };
}
