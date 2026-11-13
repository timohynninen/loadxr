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
      const stack = base
        ? `On ${base.label} · ${item.weight} / ${base.maxAbove} kg above · ${base.height + item.height} mm combined`
        : upper
          ? `${upper.label} above · ${item.weight + upper.weight} kg combined · ${item.maxAbove} kg upper limit`
          : '';
      return {item, stage, index, total: entries.length, location: locationText(item, shipment.trailer), stack};
    },
    move(delta) {
      index = Math.max(0, Math.min(entries.length - 1, index + delta));
      return this.current();
    }
  };
}
