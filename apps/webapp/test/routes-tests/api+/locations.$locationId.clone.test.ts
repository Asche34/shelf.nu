/**
 * Clone-location route tests.
 *
 * Pins source-location metadata, selected-asset scope, and the fresh asset
 * creation flow used by the location clone dialog.
 *
 * @see {@link file://./../../../app/routes/api+/locations.$locationId.clone.tsx}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    location: { findFirst: vi.fn() },
    asset: { findMany: vi.fn() },
  },
  createAsset: vi.fn(),
  createLocation: vi.fn(),
  requirePermission: vi.fn(),
  responseData: vi.fn(
    (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      })
  ),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: mocks.responseData };
});

// why: the route test verifies its org-scoped query and asset duplication inputs.
vi.mock("~/database/db.server", () => ({ db: mocks.db }));

// why: the location and asset services have their own transactional tests.
vi.mock("~/modules/location/service.server", () => ({
  createLocation: mocks.createLocation,
}));
vi.mock("~/modules/asset/service.server", () => ({
  createAsset: mocks.createAsset,
}));

// why: the route's permission boundary is asserted without loading a workspace.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mocks.requirePermission,
}));

import { action } from "~/routes/api+/locations.$locationId.clone";

function buildArgs(assetIds: string[] = ["asset-1"]) {
  const formData = new FormData();
  formData.set("name", "Copy room");
  assetIds.forEach((assetId, index) =>
    formData.set(`assetIds[${index}]`, assetId)
  );
  return {
    request: new Request("http://localhost/api/locations/location-1/clone", {
      method: "POST",
      body: formData,
    }),
    params: { locationId: "location-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as ActionFunctionArgs;
}

describe("POST /api/locations/:locationId/clone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ organizationId: "org-1" });
    mocks.db.location.findFirst.mockResolvedValue({
      name: "Original room",
      description: "Storage",
      address: "Main building",
      parentId: "parent-1",
    });
    mocks.db.asset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        title: "Laptop",
        description: "Office laptop",
        valuation: 1200,
        availableToBook: true,
        type: "INDIVIDUAL",
        quantity: null,
        minQuantity: null,
        consumptionType: null,
        unitOfMeasure: null,
        categoryId: "category-1",
        assetModelId: "model-1",
        tags: [{ id: "tag-1" }],
      },
    ]);
    mocks.createLocation.mockResolvedValue({
      id: "clone-location-1",
      name: "Copy room",
    });
    mocks.createAsset.mockResolvedValue({ id: "clone-asset-1" });
  });

  it("creates a location and selected assets as new records", async () => {
    const response = (await action(buildArgs())) as unknown as Response;
    const body = await response.json();

    expect(body).toMatchObject({
      error: null,
      success: true,
      locationId: "clone-location-1",
      assetsCreated: 1,
    });
    expect(mocks.createLocation).toHaveBeenCalledWith({
      name: "Copy room",
      description: "Storage",
      address: "Main building",
      parentId: "parent-1",
      userId: "user-1",
      organizationId: "org-1",
    });
    expect(mocks.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Laptop",
        locationId: "clone-location-1",
        userId: "user-1",
        organizationId: "org-1",
        tags: { set: [{ id: "tag-1" }] },
      })
    );
    expect(mocks.requirePermission).toHaveBeenCalledTimes(2);
  });

  it("refuses assets not found at the source location before creating a clone", async () => {
    mocks.db.asset.findMany.mockResolvedValue([]);

    const response = (await action(
      buildArgs(["asset-outside-location"])
    )) as unknown as Response;
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain(
      "no longer available at this location"
    );
    expect(mocks.createLocation).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
  });
});
