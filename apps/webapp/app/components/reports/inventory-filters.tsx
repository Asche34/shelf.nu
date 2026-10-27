import type { FormEvent } from "react";
import { useState } from "react";
import MultiSelect from "~/components/multi-select/multi-select";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";

type Option = { id: string; name: string };
type Props = {
  categories: Option[];
  locations: Option[];
  disabled: boolean;
};

const STATUS_OPTIONS = [
  { id: "AVAILABLE", name: "Available" },
  { id: "IN_CUSTODY", name: "In custody" },
  { id: "CHECKED_OUT", name: "Checked out" },
];
const FILTER_KEYS = ["categories", "locations", "statuses"] as const;

/** URL filters are shared by the report list, pagination, CSV and print preview. */
export function InventoryFilters({ categories, locations, disabled }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [resetCount, setResetCount] = useState(0);
  const fields = [
    { name: "categories", label: "Categories", items: categories },
    { name: "locations", label: "Locations", items: locations },
    { name: "statuses", label: "Statuses", items: STATUS_OPTIONS },
  ].map((field) => ({
    ...field,
    selectedIds: new Set(searchParams.get(field.name)?.split(",")),
  }));

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const params = new URLSearchParams(searchParams);
    for (const key of FILTER_KEYS) {
      const value = String(formData.get(key) ?? "");
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    setSearchParams(params, { replace: true });
  }

  function clearFilters() {
    const params = new URLSearchParams(searchParams);
    FILTER_KEYS.forEach((key) => params.delete(key));
    params.delete("page");
    setResetCount((count) => count + 1);
    setSearchParams(params, { replace: true });
  }

  return (
    <form
      key={`${searchParams.toString()}:${resetCount}`}
      onSubmit={applyFilters}
      className="flex flex-wrap items-end gap-3 rounded border border-gray-200 bg-white px-4 py-3"
      aria-label="Inventory filters"
    >
      {fields.map(({ name, label, items, selectedIds }) => (
        <MultiSelect
          key={name}
          name={name}
          label={label}
          items={items}
          valueKey="id"
          labelKey="name"
          defaultSelected={items.filter((item) => selectedIds.has(item.id))}
          placeholder={`All ${label.toLowerCase()}`}
          disabled={disabled}
          className="min-w-48 flex-1"
        />
      ))}
      <Button type="submit" variant="secondary" disabled={disabled}>
        {disabled ? "Updating..." : "Apply filters"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={clearFilters}
        disabled={disabled}
      >
        Clear filters
      </Button>
      <p className="w-full text-xs text-gray-600">
        Filters apply to the list, CSV export, and printed report.
      </p>
    </form>
  );
}
