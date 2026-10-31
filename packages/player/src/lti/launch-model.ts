/** The deployment that a message belongs to: the platform, the tool's client at the platform, and the deployment. */
export interface LtiDeployment {
  /** The issuer identifier of the platform (`iss`). */
  readonly issuer: string;
  /** The client identifier of the tool at the platform (`aud`). */
  readonly clientId: string;
  /** The deployment of the tool at the platform (LTI 1.3 Core section 5.3.3). */
  readonly deploymentId: string;
}

/** What every validated launch carries. */
export interface LaunchBase extends LtiDeployment {
  /** The endpoint that the launch is for. The tool relies on this claim and not on the unsigned parameter of the login (LTI 1.3 Core section 5.3.4). */
  readonly targetLinkUri: string;
  /** The identifier of the user in the platform, absent in an anonymous launch (LTI 1.3 Core section 5.3.6.1). */
  readonly subject?: string;
  /** The role URIs of the user in the context of the launch; possibly empty (LTI 1.3 Core section 5.3.7). */
  readonly roles: readonly string[];
  /** The custom properties that the platform sent with the link, by name (LTI 1.3 Core section 5.4.6). */
  readonly custom: ReadonlyMap<string, string>;
}

/** The resource link a launch comes from (LTI 1.3 Core section 5.3.5). */
export interface ResourceLink {
  /** The identifier of the link within the deployment. */
  readonly id: string;
  /** The title of the link, when the platform sent one. */
  readonly title?: string;
  /** The description of the link, when the platform sent one. */
  readonly description?: string;
}

/** The Assignment and Grade Services that the launch makes available (LTI AGS 2.0 section 3.1). */
export interface AgsEndpoint {
  /** The scopes that the tool may ask an access token for. */
  readonly scopes: readonly string[];
  /** The URL of the line item container of the context, when the tool may use it. */
  readonly lineitems?: string;
  /** The URL of the one line item of the launched resource, when it has exactly one. */
  readonly lineitem?: string;
}

/** A launch of a resource link (`LtiResourceLinkRequest`). */
export interface ResourceLinkLaunch extends LaunchBase {
  /** The message type. */
  readonly messageType: "LtiResourceLinkRequest";
  /** The link that was launched. */
  readonly resourceLink: ResourceLink;
  /** The grade services of the launch, absent when the platform offers none. */
  readonly ags?: AgsEndpoint;
}

/** What the platform asks of the tool in a Deep Linking request (Deep Linking 2.0 section 4.4.1). */
export interface DeepLinkingSettings {
  /** Where the tool sends the response (`deep_link_return_url`). */
  readonly returnUrl: string;
  /** The content item types that the platform accepts, such as `ltiResourceLink`. */
  readonly acceptTypes: readonly string[];
  /** Whether the platform accepts several items in one response; absent when the platform does not say. */
  readonly acceptMultiple?: boolean;
  /** An opaque value that the response must return. */
  readonly data?: string;
}

/** A launch that asks the tool to select content (`LtiDeepLinkingRequest`). */
export interface DeepLinkingLaunch extends LaunchBase {
  /** The message type. */
  readonly messageType: "LtiDeepLinkingRequest";
  /** What the platform asks of the tool. */
  readonly settings: DeepLinkingSettings;
}

/** A launch that `ltiLaunch` has validated: a resource link launch or a Deep Linking request. */
export type LtiLaunch = ResourceLinkLaunch | DeepLinkingLaunch;
