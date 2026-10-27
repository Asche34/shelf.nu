/**
 * @file Visual Asset Inventory report content.
 *
 * Lightweight variant of the Asset Inventory report focused on visual
 * cataloging: shows thumbnail, name, status, category, location, and
 * total quantity. Reuses the same row shape as the Asset Inventory report
 * (AssetInventoryRow) and the shared ReportTable primitives.
 */

import type { ColumnDef } from "@tanstack/react-table";
import type { AssetInventoryRow } from "~/modules/reports/types";

import { ReportEmptyState } from "./report-empty-state";
import { ReportTable, StatusCell, NumberCell, AssetCell } from "./report-table";

type Props = {
  rows: AssetInventoryRow[];
  totalRows: number;
  onRowClick?: (row: AssetInventoryRow) => void;
};

/**
 * Columns kept intentionally minimal and hoisted to module scope so the
 * column function references remain stable across re-renders.
 */
const GRAPHIC_COLUMNS: ColumnDef<AssetInventoryRow>[] = [
  {
    accessorKey: "assetName",
    header: "Asset",
    cell: ({ row }) => (
      <AssetCell
        name={row.original.assetName}
        thumbnailImage={row.original.thumbnailImage}
        mainImage={row.original.mainImage}
        assetId={row.original.assetId}
        assetModel={row.original.assetModel}
      />
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusCell status={row.original.status} variant="neutral" />
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) =>
      row.original.category || <span className="text-gray-400">None</span>,
  },
  {
    accessorKey: "location",
    header: "Location",
    cell: ({ row }) =>
      row.original.location || <span className="text-gray-400">None</span>,
  },
  {
    accessorKey: "quantity",
    header: "Total quantity",
    cell: ({ row }) => <NumberCell value={row.original.quantity ?? 1} />,
  },
];

/**
 * Displays the graphic asset inventory's visual columns in a report table.
 *
 * @param props - Inventory rows, total row count, and optional row navigation.
 * @returns The graphic asset inventory table.
 */
export function GraphicAssetInventoryContent({
  rows,
  totalRows,
  onRowClick,
}: Props) {
  const columns = GRAPHIC_COLUMNS;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 md:px-6">
          <h3 className="text-sm font-semibold text-gray-900">
            Visual Asset Inventory
          </h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {totalRows}
          </span>
        </div>
        <ReportTable
          data={rows}
          columns={columns}
          onRowClick={onRowClick}
          emptyContent={
            <ReportEmptyState
              reason="no_data"
              title="No assets in inventory"
              description="No assets match this report. Try clearing the filters or adding assets."
            />
          }
        />
      </div>
    </div>
  );
}
