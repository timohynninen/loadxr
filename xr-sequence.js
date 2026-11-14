import {makeStages, validatePlan, locationText} from './model.js';

// The XR guide follows exactly the existing By item sequence. Navigation is read-only.
export function createSequence(shipment) {
  validatePlan(shipment.items, shipment.placements, shipment.trailer);
  const entries = makeStages(shipment.items, shipment.placements)
    .flatMap(stage => stage.items.map(item => ({item, stage})));
  let index = 0;
  return {
    get index() { return index; },
    get length() { return entries.length; },
    current() {
      const {item, stage} = entries[index];
      const base = shipment.items.find(i => i.id === item.placement.base);
      const upper = shipment.items.find(i => i.id === item.upper);
      // Show complete assemblies intersecting the current loading rows and
      // the previous physical row, including units spanning several rows.
      const start = Math.max(0, (stage.first - 2) * 1200);
      const end = Math.min(shipment.trailer.length, stage.last * 1200);
      const contextIds = shipment.placements.filter(p => {
        const source = shipment.items.find(i => i.id === p.id);
        return p.x < end && p.x + source.length > start;
      }).map(p => p.id);
      const stack = base
        ? `On ${base.label} · ${item.weight} / ${base.maxAbove} kg above · ${base.height + item.height} mm combined`
        : upper
          ? `${upper.label} above · ${item.weight + upper.weight} kg combined · ${item.maxAbove} kg upper limit`
          : '';
      return {item, stage, index, total: entries.length, location: locationText(item, shipment.trailer), stack, baseLabel: base?.label || '', context: {ids: contextIds, start, end, showFront: index === 0}};
    },
    move(delta) {
      index = Math.max(0, Math.min(entries.length - 1, index + delta));
      return this.current();
    }
  };
}

export function conciseDetails(step) {
  const [lanes, rows] = step.location.split(' · ');
  return {
    title: `${step.item.label} · ${step.item.name}`,
    detail: `${step.item.weight} kg · ${rows}${step.baseLabel ? ` · on ${step.baseLabel}` : ` · ${lanes.replaceAll(' + ', '/')}`}`
  };
}
