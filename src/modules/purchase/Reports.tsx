import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../../core/api";
import { call } from "../../core/bridge";
import { todayInZone } from "../../core/time";
import { toast } from "../../core/toasts";
import { Select } from "../../components/Select";
import { ErrorNote, Spinner, cx } from "../../components/ui";
import { btnSmall, Empty, input } from "../../components/PageKit";
import { qty, whole } from "../inventory/api";
import { pick } from "../inventory/pickers";
import {
  purchaseExportName,
  type PurchaseExport,
  type PurchaseReport,
} from "@shared/purchase";
import { fetchReport, KP, type ReportTable } from "./api";
import { refusalText } from "./chain";
import { Head } from "./parts";

/**
 * Reports (S-11, G-26, G-27): where the money went (by vendor, product or category), spend by department and by
 * project, how long an order takes from request to receipt, what RFQs saved against target, spend with no order
 * (maverick), and whether vendors deliver. Each is saved to this computer as CSV, Excel or PDF — the server's own file,
 * through the download manager.
 */
/** `exports`: the server builds the file (Purchasing's reports); Inventory's analytics are read here only. */
export const REPORTS: Array<{
  id: string;
  label: string;
  sub: string;
  exports: boolean;
}> = [
  {
    id: "spend",
    label: "Where the money went",
    sub: "Spend by vendor, product or category",
    exports: false,
  },
  {
    id: "spend-department",
    label: "Spend by department",
    sub: "Ordered, still to arrive, received and billed, by department",
    exports: true,
  },
  {
    id: "spend-project",
    label: "Spend by project",
    sub: "What each project has bought",
    exports: true,
  },
  {
    id: "cycle-time",
    label: "Order cycle time",
    sub: "Request → order → receipt → bill, in days",
    exports: true,
  },
  {
    id: "rfq-savings",
    label: "RFQ savings",
    sub: "Awarded against target cost",
    exports: true,
  },
  {
    id: "maverick",
    label: "Maverick spend",
    sub: "Bills with no order behind them",
    exports: true,
  },
  {
    id: "vendor-performance",
    label: "Do they deliver?",
    sub: "On time, lead time and rejections by vendor",
    exports: false,
  },
];

function cell(
  v: unknown,
  kind: ReportTable["columns"][number]["kind"],
  currency: string | null,
): string {
  if (v === null || v === undefined || v === "") return "—";
  if (kind === "money") return whole(v, currency);
  if (kind === "percent") return `${Number(v).toFixed(1)}%`;
  if (kind === "number") return qty(v);
  if (kind === "days") return `${Number(v).toFixed(1)} days`;
  return String(v);
}

export default function Reports({
  org,
  currency,
  report,
  onReport,
}: {
  org: string;
  currency: string | null;
  report: string | null;
  onReport: (r: string) => void;
}) {
  const today = todayInZone();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [by, setBy] = useState("vendor");
  const key = REPORTS.find((r) => r.id === report)?.id ?? "spend";
  const meta = REPORTS.find((r) => r.id === key)!;
  const f = { from, to, by: key === "spend" ? by : undefined };
  const q = useQuery({
    queryKey: KP.report(key, org, f),
    queryFn: ({ signal }) => fetchReport(key, org, f, signal),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  const save = async (format: "csv" | "xlsx" | "pdf") => {
    if (!meta.exports) return;
    const x: PurchaseExport = {
      what: "report",
      report: key as PurchaseReport,
      format,
      from,
      to,
      ...(org ? { org } : {}),
    };
    try {
      await call("transfers:download", {
        purchaseExport: x,
        name: purchaseExportName(x, key, today),
      });
      toast("success", "The report is downloading — see Downloads");
    } catch (e) {
      toast("error", refusalText(e));
    }
  };
  const t = q.data;
  return (
    <div className="flex h-full min-h-0 gap-4 px-6 py-5">
      <nav
        aria-label="Reports"
        className="flex w-[220px] shrink-0 flex-col gap-0.5"
      >
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-current={r.id === key ? "page" : undefined}
            onClick={() => onReport(r.id)}
            className={cx(
              "flex flex-col rounded-[8px] px-2.5 py-1.5 text-left",
              r.id === key
                ? "bg-info-bg dark:bg-selection"
                : "hover:bg-subtle",
            )}
          >
            <span
              className={cx(
                "text-[13px]",
                r.id === key
                  ? "font-bold text-info-ink dark:text-primary"
                  : "font-medium text-ink",
              )}
            >
              {r.label}
            </span>
            <span className="text-[11.5px] text-ink-3">{r.sub}</span>
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Head title={meta.label} sub={meta.sub}>
          {meta.exports
            ? (["csv", "xlsx", "pdf"] as const)
                .filter((f) => !q.data?.formats || q.data.formats.includes(f))
                .map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={btnSmall}
                    onClick={() => void save(f)}
                  >
                    {f === "csv"
                      ? "Save CSV"
                      : f === "xlsx"
                        ? "Save Excel"
                        : "Save PDF"}
                  </button>
                ))
            : null}
        </Head>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
          From
          <input
            type="date"
            className={input + " !h-[30px] !w-[150px]"}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From"
          />
          to
          <input
            type="date"
            className={input + " !h-[30px] !w-[150px]"}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To"
          />
          {key === "spend" ? (
            <Select
              aria-label="Spend by"
              value={by}
              onValueChange={setBy}
              options={[
                { value: "vendor", label: "By vendor" },
                { value: "product", label: "By product" },
                { value: "category", label: "By category" },
              ]}
              className={pick + " !h-[30px] !w-[150px]"}
            />
          ) : null}
        </div>
        {q.isLoading ? (
          <Spinner />
        ) : q.error instanceof ApiError && q.error.status === 404 ? (
          <Empty text="This WorkSuite server does not have this report yet." />
        ) : q.error ? (
          <ErrorNote error={q.error} onRetry={() => void q.refetch()} />
        ) : t && t.rows.length ? (
          <>
            {t.basis ? (
              <span className="text-[12px] text-ink-3">{t.basis}</span>
            ) : null}
            <div className="overflow-auto rounded-[12px] border border-line bg-surface scroll-thin">
              <table className="w-full border-collapse text-[12.5px]">
                <thead className="sticky top-0 bg-ground text-[11px] font-bold tracking-[.4px] text-ink-3 uppercase">
                  <tr>
                    {t.columns.map((col) => (
                      <th
                        key={col.key}
                        className={cx(
                          "px-3 py-2 text-left",
                          col.kind && col.kind !== "text" && "text-right",
                        )}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.rows.map((row, i) => (
                    <tr key={i} className="border-t border-line/60">
                      {t.columns.map((col) => (
                        <td
                          key={col.key}
                          className={cx(
                            "px-3 py-1.5",
                            col.kind && col.kind !== "text"
                              ? "text-right tabular-nums"
                              : "text-ink",
                          )}
                        >
                          {cell(row[col.key], col.kind, currency)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {t.total ? (
                    <tr className="border-t border-line bg-ground font-bold">
                      {t.columns.map((col, i) => (
                        <td
                          key={col.key}
                          className={cx(
                            "px-3 py-1.5",
                            col.kind && col.kind !== "text"
                              ? "text-right tabular-nums"
                              : "text-ink",
                          )}
                        >
                          {i === 0 && t.total![col.key] === undefined
                            ? "Total"
                            : cell(t.total![col.key], col.kind, currency)}
                        </td>
                      ))}
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <Empty text="Nothing in this period." />
        )}
      </div>
    </div>
  );
}
