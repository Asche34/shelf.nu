import React, { useRef, useMemo, useState, useEffect } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { BarcodeType } from "@prisma/client";
import { changeDpiDataUrl } from "changedpi";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import { useReactToPrint } from "react-to-print";
import { BarcodeDisplay } from "~/components/barcode/barcode-display";
import { Button } from "~/components/shared/button";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { useRoleAccess } from "~/hooks/use-role-access";
import { resolveShowShelfBranding } from "~/utils/branding";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { slugify } from "~/utils/slugify";
import { tw } from "~/utils/tw";
import { waitForImagesToLoad } from "~/utils/wait-for-images";
import { AddBarcodeDialog } from "./add-barcode-dialog";
import { Ean13LookupLink } from "../barcode/barcode-card";
import { UnlockBarcodesModal } from "../barcode/unlock-barcodes-banner";
import { CrispButton } from "../marketing/crisp";
import When from "../when/when";

type SizeKeys = "cable" | "small" | "medium" | "large";

export interface CodeType {
  id: string;
  type: "qr" | "barcode";
  label: string;
  // QR specific
  qrData?: {
    size: SizeKeys;
    src: string;
  };
  // Barcode specific
  barcodeData?: {
    type: BarcodeType;
    value: string;
  };
}

/**
 * Module-scope default for the `barcodes` prop. Using a fresh `[]` as the
 * default value triggers identity churn through `useMemo`/`useEffect` dep
 * arrays on every render, so we share a single frozen reference instead.
 */
const EMPTY_BARCODES: Array<{
  id: string;
  type: BarcodeType;
  value: string;
}> = [];

/** Frame/container style for barcode labels (rendered for export/print). */
const LABEL_CONTAINER_STYLE: CSSProperties = {
  width: "300px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexDirection: "column",
  gap: "12px",
  borderRadius: "4px",
  border: "5px solid #E3E4E8",
  padding: "24px 17px 24px 17px",
  backgroundColor: "white",
};

/**
 * QR labels print on 45mm x 35mm stock. We lay the label out at a 9:7 pixel
 * design size and scale that design down for print, so text, padding and the
 * QR keep their proportions on the small physical label.
 */
export const QR_LABEL_PIXEL_WIDTH = 315;
export const QR_LABEL_PIXEL_HEIGHT = 245;

const QR_LABEL_PRINT_WIDTH_MM = 45;
const QR_LABEL_PRINT_HEIGHT_MM = 35;

/** CSS defines 1in as 96px, so this converts the 45mm print width to px. */
const QR_LABEL_PRINT_SCALE = (
  (QR_LABEL_PRINT_WIDTH_MM * 96) /
  25.4 /
  QR_LABEL_PIXEL_WIDTH
).toFixed(6);

/** Outer label box: one per printed page. */
const QR_LABEL_PAGE_STYLE: CSSProperties = {
  width: "100%",
  maxWidth: `${QR_LABEL_PIXEL_WIDTH}px`,
  height: `${QR_LABEL_PIXEL_HEIGHT}px`,
  boxSizing: "border-box",
  overflow: "hidden",
  backgroundColor: "white",
};

/** Inner design: horizontal layout with details left and QR right. */
const QR_LABEL_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  overflow: "hidden",
  borderRadius: "4px",
  border: "5px solid #E3E4E8",
  padding: "12px 16px",
  backgroundColor: "white",
};

/** Stack labels vertically; print rules below put each one on its own page. */
const QR_LABEL_PAGES_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "16px",
  width: "100%",
  maxWidth: `${QR_LABEL_PIXEL_WIDTH}px`,
};

/** Each copied label gets its own page, and the last one must not add a blank one. */
const QR_LABEL_PRINT_STYLE = `
  @page {
    size: ${QR_LABEL_PRINT_WIDTH_MM}mm ${QR_LABEL_PRINT_HEIGHT_MM}mm;
    margin: 0;
  }
  @media print {
    .qr-label-pages {
      display: block !important;
      gap: 0 !important;
      width: auto !important;
      max-width: none !important;
    }
    .qr-label-page {
      width: ${QR_LABEL_PRINT_WIDTH_MM}mm !important;
      height: ${QR_LABEL_PRINT_HEIGHT_MM}mm !important;
      max-width: none !important;
      overflow: hidden !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      break-after: page !important;
      page-break-after: always !important;
    }
    .qr-label-inner {
      width: ${QR_LABEL_PIXEL_WIDTH}px !important;
      height: ${QR_LABEL_PIXEL_HEIGHT}px !important;
      transform: scale(${QR_LABEL_PRINT_SCALE}) !important;
      transform-origin: top left !important;
    }
    .qr-label-page:last-child {
      break-after: auto !important;
      page-break-after: auto !important;
    }
  }
`;

const BARCODE_LABEL_STYLE: CSSProperties = {
  ...LABEL_CONTAINER_STYLE,
  minHeight: "300px",
};

/** Title text at the top of a barcode label — truncated, bold, centered. */
const LABEL_TITLE_STYLE: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  maxWidth: "100%",
  color: "black",
  textAlign: "center",
};

/** Left column of a QR label: organization, location, title and ID. */
const QR_LABEL_DETAILS_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: "4px",
  flex: "1 1 auto",
  minWidth: 0,
  height: "100%",
  color: "black",
};

const QR_LABEL_ORGANIZATION_STYLE: CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const QR_LABEL_META_STYLE: CSSProperties = {
  fontSize: "11px",
  color: "#4b5563",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const QR_LABEL_TITLE_STYLE: CSSProperties = {
  fontSize: "14px",
  fontWeight: 700,
  lineHeight: 1.2,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const QR_LABEL_ID_STYLE: CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** Right column of a QR label. */
const QR_LABEL_CODE_STYLE: CSSProperties = {
  flex: "0 0 140px",
  width: "140px",
  height: "140px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const QR_LABEL_IMAGE_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
};

interface CodePreviewProps {
  className?: string;
  style?: CSSProperties;
  hideButton?: boolean;
  item: {
    id: string; // Need the ID to construct the action URL
    name: string;
    type: "asset" | "kit";
  };
  qrObj?: {
    qr?: {
      size: SizeKeys;
      id: string;
      src: string;
    };
  };
  barcodes?: Array<{
    id: string;
    type: BarcodeType;
    value: string;
  }>;
  onCodeChange?: (code: CodeType | null) => void;
  selectedBarcodeId?: string;
  onRefetchData?: () => void; // Callback to refetch data when barcode is added
  sequentialId?: string | null;
  showShelfBranding?: boolean;
  quantity?: number | null;
  location?: { name: string } | null;
}

// react-doctor:no-giant-component — deferred for follow-up refactor
export const CodePreview = ({
  className,
  style,
  qrObj,
  barcodes = EMPTY_BARCODES,
  item,
  hideButton = false,
  onCodeChange,
  selectedBarcodeId,
  onRefetchData,
  sequentialId,
  showShelfBranding,
  quantity,
  location,
}: CodePreviewProps) => {
  const captureDivRef = useRef<HTMLDivElement>(null);
  const downloadBtnRef = useRef<HTMLAnchorElement>(null);
  const { canUseBarcodes } = useBarcodePermissions();
  const roles = useOrganizationRoles();
  const { ownsWorkspace: isOwner } = useRoleAccess();
  /** Adding a code writes to the asset, so it follows `asset:update`. */
  const canAddCode = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.update,
  });
  const organization = useCurrentOrganization();
  const resolvedShowShelfBranding = resolveShowShelfBranding(
    showShelfBranding,
    organization?.showShelfBranding
  );
  const [isAddBarcodeDialogOpen, setIsAddBarcodeDialogOpen] = useState(false);

  // Build available codes list
  const availableCodes: CodeType[] = useMemo(() => {
    const codes: CodeType[] = [];

    // Add QR code if available
    if (qrObj?.qr) {
      codes.push({
        id: qrObj.qr.id,
        type: "qr",
        label: "Shelf QR Code",
        qrData: {
          size: qrObj.qr.size,
          src: qrObj.qr.src,
        },
      });
    }

    // Add barcodes if available and permissions allow
    if (canUseBarcodes) {
      barcodes.forEach((barcode) => {
        const isExternalQr = barcode.type === "ExternalQR";
        const label = isExternalQr
          ? "External QR Code"
          : `${barcode.type} - ${barcode.value}`;

        codes.push({
          id: barcode.id,
          type: "barcode",
          label,
          barcodeData: {
            type: barcode.type,
            value: barcode.value,
          },
        });
      });
    }

    return codes;
  }, [qrObj, barcodes, canUseBarcodes]);

  // Default to selected barcode, then QR code if available, otherwise first barcode
  const [selectedCodeId, setSelectedCodeId] = useState<string>(() => {
    // If a specific barcode is selected, prioritize it
    if (selectedBarcodeId) {
      const selectedBarcode = availableCodes.find(
        (code) => code.id === selectedBarcodeId
      );
      if (selectedBarcode) {
        return selectedBarcodeId;
      }
    }

    // Otherwise default to QR code if available, then first barcode
    const qrCode = availableCodes.find((code) => code.type === "qr");
    return qrCode?.id || availableCodes[0]?.id || "";
  });

  // Notify parent of initial selection (moved to useEffect to avoid render-time side effects)
  useEffect(() => {
    const selectedBarcode = availableCodes.find(
      (code) => code.id === selectedCodeId
    );
    if (onCodeChange && selectedBarcode) {
      onCodeChange(selectedBarcode);
    }
  }, [selectedCodeId, availableCodes, onCodeChange]);

  const selectedCode = availableCodes.find(
    (code) => code.id === selectedCodeId
  );
  const qrCopyCount =
    typeof quantity === "number" && Number.isInteger(quantity) && quantity > 1
      ? quantity
      : 1;
  const isMultiQrPrint = selectedCode?.type === "qr" && qrCopyCount > 1;

  useEffect(() => {
    // Keep selection in sync when codes change (e.g., new QR after relink)
    const hasSelectedCode = availableCodes.some(
      (code) => code.id === selectedCodeId
    );

    if (hasSelectedCode) return;

    // Prefer the externally requested barcode, then fallback to QR, then any barcode
    const selectedBarcode = selectedBarcodeId
      ? availableCodes.find((code) => code.id === selectedBarcodeId)
      : undefined;

    if (selectedBarcode) {
      setSelectedCodeId(selectedBarcode.id);
      return;
    }

    const fallbackQr = availableCodes.find((code) => code.type === "qr");
    const fallbackBarcode = availableCodes.find(
      (code) => code.type === "barcode"
    );
    setSelectedCodeId(fallbackQr?.id || fallbackBarcode?.id || "");
  }, [availableCodes, selectedBarcodeId, selectedCodeId]);

  const fileName = useMemo(() => {
    if (!selectedCode) return "";

    const prefix = `${slugify(item.name || item.type)}`;
    if (selectedCode.type === "qr") {
      return `${prefix}-${selectedCode.qrData?.size}-shelf-qr-code-${selectedCode.id}.png`;
    } else {
      return `${prefix}-${selectedCode.barcodeData?.type}-barcode-${selectedCode.barcodeData?.value}.png`;
    }
  }, [item, selectedCode]);

  async function captureNodeAsPng(node: HTMLElement) {
    const options = {
      width: node.offsetWidth,
      height: node.offsetHeight,
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "white",
    };

    // Safari/iPad workaround: html-to-image needs to be called twice
    // First call "primes" the rendering, second call captures correctly
    await waitForImagesToLoad(node);
    await toPng(node, options); // First call (prime)
    return toPng(node, options); // Second call (actual capture)
  }

  function triggerDownload(href: string, name: string) {
    const downloadLink = document.createElement("a");
    downloadLink.href = href;
    downloadLink.download = name;
    downloadLink.click();
  }

  async function downloadCode(e: MouseEvent<HTMLButtonElement>) {
    const captureDiv = captureDivRef.current;
    const downloadBtn = downloadBtnRef.current;

    if (!captureDiv || !downloadBtn) return;

    e.preventDefault();

    try {
      /**
       * A QR label renders one `.qr-label-page` per copy. Capture them
       * individually so each download contains exactly one QR code.
       */
      const labelNodes = Array.from(
        captureDiv.querySelectorAll<HTMLElement>(".qr-label-page")
      );
      const nodes = labelNodes.length > 0 ? labelNodes : [captureDiv];
      const baseName = fileName.replace(/\.[^.]+$/, "");

      if (nodes.length === 1) {
        const dataUrl = await captureNodeAsPng(nodes[0]);
        triggerDownload(changeDpiDataUrl(dataUrl, 300), fileName);
        return;
      }

      const zip = new JSZip();
      const folder = zip.folder("qr-codes") ?? zip;

      for (let index = 0; index < nodes.length; index++) {
        const dataUrl = changeDpiDataUrl(
          await captureNodeAsPng(nodes[index]),
          300
        );
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const suffix = `-${String(index + 1).padStart(3, "0")}`;
        folder.file(`${baseName}${suffix}.png`, base64, { base64: true });
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, `${baseName}.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 4e4);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }

  const printCode = useReactToPrint({
    contentRef: captureDivRef,
    pageStyle: selectedCode?.type === "qr" ? QR_LABEL_PRINT_STYLE : undefined,
    onBeforePrint: () => {
      const container = captureDivRef.current;
      if (!container) return Promise.resolve();
      return waitForImagesToLoad(container);
    },
  });

  // Don't render if no codes available
  if (availableCodes.length === 0) {
    return null;
  }

  return (
    <div
      className={tw("mb-4 w-auto rounded border bg-white", className)}
      style={style}
    >
      {/* Code Selector */}
      <div className="w-full border-b-[1.1px] border-[#E3E4E8] px-4 py-3">
        <div className="flex items-center justify-center gap-2">
          <select
            id="code-selector"
            aria-label="Select code to display"
            value={selectedCodeId}
            onChange={(e) => {
              setSelectedCodeId(e.target.value);
              const newSelectedCode = availableCodes.find(
                (code) => code.id === e.target.value
              );
              onCodeChange?.(newSelectedCode || null);
            }}
            className={tw(
              "min-w-0  flex-1 truncate rounded-md border border-gray-300 bg-white px-3 py-2 pr-7 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
              canAddCode ? "max-w-[280px]" : "max-w-[320px]"
            )}
          >
            {availableCodes.map((code) => (
              <option key={code.id} value={code.id}>
                {code.label}
              </option>
            ))}
          </select>
          <When truthy={canAddCode}>
            <Button
              type="button"
              icon="plus"
              variant="secondary"
              size="sm"
              onClick={() => setIsAddBarcodeDialogOpen(true)}
              aria-label="Add code to asset"
              disabled={
                !canUseBarcodes
                  ? {
                      reason: isOwner ? (
                        <>
                          Your workspace doesn't have the barcodes addon
                          enabled.{" "}
                          <UnlockBarcodesModal
                            triggerVariant="link"
                            triggerLabel="Learn more"
                          />
                        </>
                      ) : (
                        <>
                          Your workspace doesn't currently support barcodes.
                          Contact your workspace owner to enable this feature,
                          or get in touch with{" "}
                          <CrispButton variant="link">sales</CrispButton>.
                        </>
                      ),
                    }
                  : false
              }
              tooltip={canUseBarcodes ? "Add code to asset" : undefined}
              className="shrink-0"
            />
          </When>
        </div>
      </div>

      {/* Code Preview */}
      <div
        className={tw(
          "flex w-full justify-center pt-6",
          isMultiQrPrint && "max-h-[70vh] overflow-auto"
        )}
      >
        {selectedCode?.type === "qr" ? (
          <QrLabel
            ref={captureDivRef}
            data={{ qr: { id: selectedCode.id, ...selectedCode.qrData } }}
            title={item.name}
            location={location}
            organizationName={organization?.name}
            qrIdDisplayPreference={organization?.qrIdDisplayPreference}
            sequentialId={sequentialId}
            showShelfBranding={resolvedShowShelfBranding}
            quantity={quantity}
          />
        ) : selectedCode?.type === "barcode" ? (
          <BarcodeLabel
            ref={captureDivRef}
            data={selectedCode.barcodeData}
            title={item.name}
            showShelfBranding={resolvedShowShelfBranding}
          />
        ) : null}
      </div>

      {/* Actions */}
      <When truthy={!hideButton && !!selectedCode}>
        <div className="mt-8 flex w-full items-center gap-3 border-t-[1.1px] border-[#E3E4E8] px-4 py-3">
          <Button
            type="button"
            icon="download"
            onClick={downloadCode}
            download={fileName}
            ref={downloadBtnRef}
            variant="secondary"
            className="w-full"
          >
            Download
          </Button>
          <Button
            type="button"
            icon="print"
            variant="secondary"
            className="w-full"
            onClick={printCode}
          >
            Print
          </Button>
        </div>
      </When>

      {/* Add Barcode Dialog */}
      <AddBarcodeDialog
        isOpen={isAddBarcodeDialogOpen}
        onClose={() => setIsAddBarcodeDialogOpen(false)}
        item={item}
        onRefetchData={onRefetchData}
      />
    </div>
  );
};

// QR Label Component (existing)
export type QrDef = {
  id?: string;
  size?: SizeKeys;
  src?: string;
};

interface QrLabelProps {
  data?: { qr?: QrDef };
  title: string;
  qrIdDisplayPreference?: string;
  sequentialId?: string | null;
  showShelfBranding?: boolean;
  quantity?: number | null;
  location?: { name: string } | null;
  organizationName?: string;
  /** When set, renders only the label for this zero-based copy. */
  copyIndex?: number;
  /** Fixed label width in pixels, used for rasterized exports. */
  labelWidth?: number;
}

/**
 * Renders one QR label: organization, location, title and identifier on the
 * left, QR image on the right.
 */
function QrLabelContent({
  data,
  title,
  label,
  location,
  organizationName,
  showShelfBranding,
}: {
  data?: { qr?: QrDef };
  title: string;
  label: string | undefined;
  location?: { name: string } | null;
  organizationName?: string;
  showShelfBranding: boolean;
}) {
  return (
    <>
      <div style={QR_LABEL_DETAILS_STYLE}>
        {organizationName ? (
          <div style={QR_LABEL_ORGANIZATION_STYLE}>{organizationName}</div>
        ) : null}
        {location?.name ? (
          <div style={QR_LABEL_META_STYLE}>{location.name}</div>
        ) : null}
        <div style={QR_LABEL_TITLE_STYLE}>{title}</div>
        <div style={QR_LABEL_ID_STYLE}>{label}</div>
        {showShelfBranding ? (
          <div style={QR_LABEL_META_STYLE}>
            Powered by{" "}
            <span className="font-semibold text-black">shelf.nu</span>
          </div>
        ) : null}
      </div>
      <figure className="qr-code" style={QR_LABEL_CODE_STYLE}>
        <img
          src={data?.qr?.src}
          alt={`${data?.qr?.size}-shelf-qr-code.png`}
          style={QR_LABEL_IMAGE_STYLE}
        />
      </figure>
    </>
  );
}

export const QrLabel = React.forwardRef<HTMLDivElement, QrLabelProps>(
  function QrLabel(props, ref) {
    const {
      data,
      title,
      qrIdDisplayPreference,
      sequentialId,
      showShelfBranding = true,
      quantity,
      location,
      organizationName,
      copyIndex,
      labelWidth,
    } = props ?? {};

    const baseLabel =
      qrIdDisplayPreference === "SAM_ID" && sequentialId
        ? sequentialId
        : data?.qr?.id;
    const copyCount =
      typeof quantity === "number" && Number.isInteger(quantity) && quantity > 1
        ? quantity
        : 1;
    const copyIndexes =
      copyIndex === undefined
        ? Array.from({ length: copyCount }, (_, index) => index)
        : [copyIndex];
    const pageStyle = labelWidth
      ? { ...QR_LABEL_PAGE_STYLE, width: `${labelWidth}px`, maxWidth: "none" }
      : QR_LABEL_PAGE_STYLE;
    const pagesStyle = labelWidth
      ? {
          ...QR_LABEL_PAGES_STYLE,
          width: `${labelWidth}px`,
          maxWidth: `${labelWidth}px`,
        }
      : QR_LABEL_PAGES_STYLE;

    return (
      <div ref={ref} className="qr-label-pages" style={pagesStyle}>
        {copyIndexes.map((index) => {
          const label =
            copyCount > 1 && qrIdDisplayPreference === "SAM_ID" && sequentialId
              ? `${sequentialId}-${String(index + 1).padStart(3, "0")}`
              : baseLabel;
          return (
            <div key={index} className="qr-label-page" style={pageStyle}>
              <div className="qr-label-inner" style={QR_LABEL_STYLE}>
                <QrLabelContent
                  data={data}
                  title={title}
                  label={label}
                  location={location}
                  organizationName={organizationName}
                  showShelfBranding={showShelfBranding}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }
);

// Barcode Label Component (new)
interface BarcodeLabelProps {
  data?: {
    type: BarcodeType;
    value: string;
  };
  title: string;
  showShelfBranding?: boolean;
}

export const BarcodeLabel = React.forwardRef<HTMLDivElement, BarcodeLabelProps>(
  function BarcodeLabel(props, ref) {
    const { data, title, showShelfBranding = true } = props ?? {};

    if (!data) return null;

    return (
      <div style={BARCODE_LABEL_STYLE} ref={ref}>
        <div style={LABEL_TITLE_STYLE}>{title}</div>
        <div className="flex flex-1 items-center justify-center">
          <BarcodeDisplay
            type={data.type}
            value={data.value}
            maxWidth="250px"
          />
        </div>
        <div className="w-full text-center text-[12px]">
          <div className="font-semibold">
            {data.type}:{" "}
            <div className="break-all leading-tight [overflow-wrap:break-word]">
              {data.type === "EAN13" ? (
                <Ean13LookupLink
                  value={data.value}
                  content={data.value}
                  className="text-[12px]"
                />
              ) : (
                data.value
              )}
            </div>
          </div>
          {showShelfBranding ? (
            <div>
              Powered by{" "}
              <span className="font-semibold text-black">shelf.nu</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
);
