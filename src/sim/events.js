/** Push `{ type, ...data }` onto `world.events`. */
export function emit(world, type, data = {}) {
  world.events.push({ type, ...data });
}
