/**
 * Pins the asset code preview response fields consumed by `CodePreviewDialog`.
 *
 * @see {@link file://../../../app/routes/api+/assets.$assetId.generate-code-obj.ts}
 * @see {@link file://../../../app/components/code-preview/code-preview-dialog.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

const routeMocks = vi.hoisted(() => ({
  getAsset: vi.fn(),
  generateQrObj: vi.fn(),
}));

// why: asset persistence is not under test; its result supplies the response fields.
vi.mock("~/modules/asset/service.server", () => ({
  getAsset: routeMocks.getAsset,
}));

// why: QR generation is not under test; the response shape is.
vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: routeMocks.generateQrObj,
}));

// why: authorization only needs to provide the active workspace context.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(async () => ({
    organizationId: "org-1",
    userOrganizations: [],
    currentOrganization: { showShelfBranding: true },
  })),
}));

const { loader } = await import(
  "~/routes/api+/assets.$assetId.generate-code-obj"
);

describe("GET /api/assets/:assetId/generate-code-obj", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.getAsset.mockResolvedValue({
      barcodes: [],
      sequentialId: "SAM-005",
      quantity: 13,
    });
    routeMocks.generateQrObj.mockResolvedValue({
      qr: { id: "qr-1", size: "medium", src: "data:image/png," },
    });
  });

  it("returns quantity with the asset code preview data", async () => {
    const result = (await loader(
      createLoaderArgs({
        context: { getSession: () => ({ userId: "user-1" }) } as never,
        params: { assetId: "asset-1" },
        request: new Request(
          "http://localhost/api/assets/asset-1/generate-code-obj"
        ),
      })
    )) as unknown as { data: Record<string, unknown> };

    expect(result.data).toMatchObject({
      error: null,
      quantity: 13,
      sequentialId: "SAM-005",
      qrObj: { qr: { id: "qr-1" } },
    });
  });
});
