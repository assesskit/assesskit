/**
 * The status that a delivery engine gives an interaction. It takes input while `interacting` or `suspended`, and shows its
 * response without taking input when `closed`, in `solution` or in `review`.
 */
type PciStatus = "interacting" | "suspended" | "closed" | "solution" | "review";

/**
 * The configuration that a delivery engine passes to `getInstance`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
interface PciConfiguration {
  /** The `data-*` attributes of the interaction, named as `dataset` names them. */
  readonly properties: Readonly<Record<string, string>>;
  /** The response variable, as the JSON of the portable custom interaction binding. */
  readonly boundTo: unknown;
  readonly responseIdentifier: string;
  readonly status: PciStatus;
  readonly onready: (interaction: PciInstance, state?: string) => void;
}

/** The instance that `getInstance` returns, with the methods that a delivery engine calls. */
export interface PciInstance {
  readonly typeIdentifier: string;
  /** The response, as the JSON of the portable custom interaction binding. */
  getResponse(): unknown;
  /** The state that restores the interaction, as a string. */
  getState(): string;
  /** Lets the interaction clean up after the engine has read its response and state. */
  oncompleted(): void;
}

/** The arguments of `getInstance` with what the module loaded: the URL of its own file and its dependencies. */
export interface InstanceArguments {
  readonly dom: HTMLElement;
  readonly configuration: PciConfiguration;
  readonly state: string | undefined;
  /** The URL that the module was loaded from, which locates its other files. */
  readonly moduleUrl: string;
  /** The modules that the interaction depends on, in the order of its dependencies. */
  readonly dependencies: readonly unknown[];
}

/** What RequireJS gives the special dependency `module`. */
interface AmdModule {
  readonly uri: string;
}

/** The communication bridge `qtiCustomInteractionContext`, with the one method that a module calls. */
interface PciContext {
  register(factory: {
    readonly typeIdentifier: string;
    getInstance(dom: HTMLElement, configuration: PciConfiguration, state?: string): PciInstance;
  }): void;
}

/** The `define` of the AMD loader that the frame runs, RequireJS, with the bridge and `module` as the first dependencies. */
declare const define: (
  dependencies: readonly string[],
  factory: (context: PciContext, module: AmdModule, ...loaded: readonly unknown[]) => void,
) => void;

/**
 * Defines the AMD module of an interaction: it registers the interaction with the communication bridge under its type
 * identifier, once its dependencies have loaded.
 *
 * @param typeIdentifier - The `custom-interaction-type-identifier` that the interaction answers to.
 * @param dependencies - The ids of the modules that the interaction needs, which the item's module resolution locates.
 * @param create - Makes an instance from the arguments of `getInstance` and what the module loaded.
 * @see {@link https://github.com/amdjs/amdjs-api/blob/master/AMD.md | Asynchronous Module Definition}
 */
export function defineInteraction(
  typeIdentifier: string,
  dependencies: readonly string[],
  create: (args: InstanceArguments) => PciInstance,
): void {
  define(["qtiCustomInteractionContext", "module", ...dependencies], (context, module, ...loaded) => {
    context.register({
      typeIdentifier,
      getInstance: (dom, configuration, state) =>
        create({ dom, configuration, state, moduleUrl: module.uri, dependencies: loaded }),
    });
  });
}

/**
 * Tells the delivery engine that the response changed, with the event that the portable custom interaction binding names.
 *
 * @param interaction - The instance whose response changed.
 * @param args - The arguments that it was made with.
 */
export function notifyChange(interaction: PciInstance, { dom, configuration }: InstanceArguments): void {
  const detail = {
    interaction,
    responseIdentifier: configuration.responseIdentifier,
    value: interaction.getResponse(),
  };
  dom.dispatchEvent(new CustomEvent("qti-interaction-changed", { bubbles: true, detail }));
}

/** Whether an interaction of a status takes input. */
export const takesInput = (status: PciStatus): boolean => status === "interacting" || status === "suspended";
