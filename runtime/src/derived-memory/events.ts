import type {
  ChangeEventPublisher,
  ChangeEventSource,
  DomainChangeEvent,
  DomainChangeHandler,
} from "./types.ts";

export class LocalChangeEventBus
  implements ChangeEventSource, ChangeEventPublisher
{
  readonly #handlers = new Set<DomainChangeHandler>();

  subscribe(handler: DomainChangeHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  publish(event: DomainChangeEvent): void {
    for (const handler of [...this.#handlers]) handler(event);
  }
}
