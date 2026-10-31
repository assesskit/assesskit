import { CSM_NAMESPACE, DRD_NAMESPACE, QTI_METADATA_NAMESPACE } from "./namespaces.js";

/** A namespace with the prefix that the writers give it. */
export interface QualifiedName {
  /** The namespace URI. */
  readonly namespace: string;
  /** The prefix that the elements of the namespace are written with. */
  readonly prefix: string;
}

/** The namespace of QTI metadata, written with the prefix `qmd`. */
export const QMD: QualifiedName = { namespace: QTI_METADATA_NAMESPACE, prefix: "qmd" };

/** The namespace of curriculum standards metadata, written with the prefix `csmd`. */
export const CSMD: QualifiedName = { namespace: CSM_NAMESPACE, prefix: "csmd" };

/** The namespace of the accessibility description, written with the prefix `drd`. */
export const DRD: QualifiedName = { namespace: DRD_NAMESPACE, prefix: "drd" };
