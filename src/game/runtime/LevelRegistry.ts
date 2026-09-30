import type { LevelFactory, LevelFactoryLoader, LevelId } from "./LevelTypes";

export class LevelRegistry {
  private readonly loaders = new Map<LevelId, LevelFactoryLoader>();

  register(id: LevelId, loader: LevelFactoryLoader) {
    if (this.loaders.has(id)) {
      throw new Error(`Level factory already registered: ${id}`);
    }
    this.loaders.set(id, loader);
    return this;
  }

  has(id: LevelId) {
    return this.loaders.has(id);
  }

  async resolve(id: LevelId): Promise<LevelFactory> {
    const loader = this.loaders.get(id);
    if (!loader) throw new Error(`Unknown level: ${id}`);
    return loader();
  }
}
