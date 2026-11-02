import { AssetType } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { createAsset } from "~/modules/asset/service.server";
import { createLocation } from "~/modules/location/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  assertIsPost,
  error,
  getParams,
  parseData,
  payload,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const CloneLocationParamsSchema = z.object({ locationId: z.string() });

/**
 * Supplies the source location's active assets and creates a location clone,
 * optionally duplicating selected assets with fresh identifiers.
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, CloneLocationParamsSchema, {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });

    const location = await db.location.findFirstOrThrow({
      where: { id: locationId, organizationId },
      select: {
        id: true,
        name: true,
        description: true,
        address: true,
        parentId: true,
      },
    });
    const assets = await db.asset.findMany({
      where: {
        organizationId,
        archivedAt: null,
        assetLocations: { some: { locationId } },
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        sequentialId: true,
      },
    });

    return data(payload({ location, assets }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    return data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, CloneLocationParamsSchema, {
    additionalData: { userId },
  });

  try {
    assertIsPost(request);
    const formData = await request.formData();
    const { name, assetIds } = parseData(
      formData,
      z.object({
        name: z.string().trim().min(2, "Name must be at least 2 characters"),
        assetIds: z.array(z.string()).max(100).default([]),
      }),
      { additionalData: { userId, locationId } }
    );
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.create,
    });

    const sourceLocation = await db.location.findFirst({
      where: { id: locationId, organizationId },
      select: {
        name: true,
        description: true,
        address: true,
        parentId: true,
      },
    });
    if (!sourceLocation) {
      throw new ShelfError({
        cause: null,
        message: "The location you want to clone could not be found.",
        additionalData: { locationId, userId, organizationId },
        status: 404,
        label: "Location",
        shouldBeCaptured: false,
      });
    }

    if (assetIds.length > 0) {
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.create,
      });
    }

    const uniqueAssetIds = [...new Set(assetIds)];
    const assets = uniqueAssetIds.length
      ? await db.asset.findMany({
          where: {
            id: { in: uniqueAssetIds },
            organizationId,
            archivedAt: null,
            assetLocations: { some: { locationId } },
          },
          select: {
            id: true,
            title: true,
            description: true,
            valuation: true,
            availableToBook: true,
            type: true,
            quantity: true,
            minQuantity: true,
            consumptionType: true,
            unitOfMeasure: true,
            categoryId: true,
            assetModelId: true,
            tags: { select: { id: true } },
          },
        })
      : [];

    if (assets.length !== uniqueAssetIds.length) {
      throw new ShelfError({
        cause: null,
        message:
          "One or more selected assets are no longer available at this location.",
        additionalData: { locationId, userId, organizationId },
        status: 400,
        label: "Location",
        shouldBeCaptured: false,
      });
    }

    const clonedLocation = await createLocation({
      name,
      description: sourceLocation.description,
      address: sourceLocation.address,
      parentId: sourceLocation.parentId,
      userId,
      organizationId,
    });

    let assetsCreated = 0;
    try {
      for (const asset of assets) {
        await createAsset({
          title: asset.title,
          description: asset.description,
          valuation: asset.valuation,
          availableToBook: asset.availableToBook,
          type: asset.type,
          quantity: asset.quantity,
          minQuantity: asset.minQuantity,
          consumptionType: asset.consumptionType,
          unitOfMeasure: asset.unitOfMeasure,
          categoryId: asset.categoryId,
          assetModelId:
            asset.type === AssetType.INDIVIDUAL
              ? asset.assetModelId ?? undefined
              : undefined,
          tags: { set: asset.tags },
          locationId: clonedLocation.id,
          userId,
          organizationId,
        });
        assetsCreated += 1;
      }
    } catch (cause) {
      throw new ShelfError({
        cause,
        title: "Location cloned with incomplete asset copies",
        message: `The new location was created, but only ${assetsCreated} of ${assets.length} assets were duplicated. Review the new location before trying again.`,
        additionalData: {
          locationId: clonedLocation.id,
          userId,
          organizationId,
          assetsCreated,
          assetsRequested: assets.length,
        },
        status: 500,
        label: "Location",
      });
    }

    return data(
      payload({
        success: true,
        locationId: clonedLocation.id,
        assetsCreated,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    return data(error(reason), { status: reason.status });
  }
}
