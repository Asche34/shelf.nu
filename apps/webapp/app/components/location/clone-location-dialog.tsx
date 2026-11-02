import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { Location } from "@prisma/client";
import { useFetcher, useNavigate } from "react-router";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import type { loader as cloneLoader } from "~/routes/api+/locations.$locationId.clone";
import type { action as cloneAction } from "~/routes/api+/locations.$locationId.clone";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

type CloneLocationDialogProps = {
  location: Pick<Location, "id" | "name">;
  trigger: ReactNode;
};

type CloneAssetChoice = {
  id: string;
  title: string;
  sequentialId: string | null;
};

/**
 * Clones a location and lets the user choose which asset records to duplicate.
 * The duplicated assets receive new QR and sequential identifiers.
 */
export function CloneLocationDialog({
  location,
  trigger,
}: CloneLocationDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${location.name} copy`);
  const roles = useOrganizationRoles();
  const navigate = useNavigate();
  const detailsFetcher = useFetcher<typeof cloneLoader>();
  const actionFetcher = useFetcher<typeof cloneAction>();
  const disabled = useDisabled(actionFetcher);
  const nameInputRef = useAutoFocus<HTMLInputElement>({ when: open });
  const canCreateAssets = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.create,
  });

  useEffect(() => {
    if (open && !detailsFetcher.data && detailsFetcher.state === "idle") {
      void detailsFetcher.load(`/api/locations/${location.id}/clone`);
    }
  }, [
    detailsFetcher,
    detailsFetcher.data,
    detailsFetcher.state,
    location.id,
    open,
  ]);

  useEffect(() => {
    if (actionFetcher.state !== "idle" || !actionFetcher.data) return;
    if (actionFetcher.data.error) return;
    if (actionFetcher.data.locationId) {
      setOpen(false);
      void navigate(`/locations/${actionFetcher.data.locationId}`);
    }
  }, [actionFetcher.data, actionFetcher.state, navigate]);

  const loadError = detailsFetcher.data?.error
    ? detailsFetcher.data.error.message
    : undefined;
  const sourceAssets = detailsFetcher.data?.error
    ? []
    : detailsFetcher.data?.assets ?? [];
  const actionError = actionFetcher.data?.error
    ? actionFetcher.data.error.message
    : undefined;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setName(`${location.name} copy`);
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Clone {location.name}</AlertDialogTitle>
          <AlertDialogDescription>
            Create a new location with the same description, address, and
            parent. Selected assets are duplicated as new records with fresh
            identifiers.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <actionFetcher.Form
          method="post"
          action={`/api/locations/${location.id}/clone`}
          className="flex min-h-0 flex-col gap-4"
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
            New location name
            <input
              ref={nameInputRef}
              name="name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              minLength={2}
              required
              className="rounded border border-gray-300 px-3 py-2"
              data-dialog-initial-focus
            />
          </label>

          <CloneAssetSelection
            assets={sourceAssets}
            canCreateAssets={canCreateAssets}
            isLoading={detailsFetcher.state !== "idle" && !detailsFetcher.data}
            loadError={loadError}
          />

          {actionError ? (
            <p role="alert" className="text-sm text-error-600">
              {actionError}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              type="submit"
              disabled={
                disabled ||
                name.trim().length < 2 ||
                detailsFetcher.state !== "idle" ||
                !detailsFetcher.data ||
                Boolean(loadError)
              }
            >
              {disabled ? "Cloning..." : "Clone location"}
            </Button>
          </AlertDialogFooter>
        </actionFetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CloneAssetSelection({
  assets,
  canCreateAssets,
  isLoading,
  loadError,
}: {
  assets: CloneAssetChoice[];
  canCreateAssets: boolean;
  isLoading: boolean;
  loadError?: string;
}) {
  if (!canCreateAssets) {
    return (
      <p className="text-sm text-gray-600">
        You can clone the location, but you do not have permission to duplicate
        assets.
      </p>
    );
  }

  return (
    <fieldset className="flex min-h-0 flex-col gap-2">
      <legend className="text-sm font-medium text-gray-700">
        Assets to duplicate
      </legend>
      <p className="text-xs text-gray-500">
        Duplicates keep asset details, category, model, and tags. Current
        status, custody, bookings, notes, and codes are not copied.
      </p>
      {isLoading ? (
        <p role="status" className="text-sm text-gray-500">
          Loading assets...
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" className="text-sm text-error-600">
          {loadError}
        </p>
      ) : null}
      <div className="max-h-64 overflow-y-auto rounded border border-gray-200">
        {assets.map((asset, index) => (
          <label
            key={asset.id}
            className="flex cursor-pointer items-center gap-3 border-b border-gray-100 px-3 py-2 last:border-b-0"
          >
            <input
              type="checkbox"
              name={`assetIds[${index}]`}
              value={asset.id}
              className="size-4 accent-primary"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
              {asset.title}
            </span>
            {asset.sequentialId ? (
              <span className="text-xs text-gray-500">
                {asset.sequentialId}
              </span>
            ) : null}
          </label>
        ))}
        {!isLoading && !loadError && assets.length === 0 ? (
          <p className="px-3 py-4 text-sm text-gray-500">
            This location has no active assets to duplicate.
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
