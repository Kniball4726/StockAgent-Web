import type { ProductoItemResponse } from "@stockagent/shared";

interface CatalogProductTableProps {
  products: ProductoItemResponse[];
  selectedCode: string | null;
  query: string;
  onSelect: (product: ProductoItemResponse) => void;
}

export function CatalogProductTable({
  products,
  selectedCode,
  query,
  onSelect,
}: CatalogProductTableProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 lg:col-span-2">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400">
              <th className="py-2 pr-3 font-medium">SKU</th>
              <th className="py-2 pr-3 font-medium">Descripción</th>
              <th className="py-2 pr-3 font-medium text-right">Stock</th>
              <th className="py-2 pr-3 font-medium">Ubicación</th>
              <th className="py-2 font-medium">Código Barras</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {products.map((prod) => {
              const isLow = prod.stock <= prod.stock_minimo;
              const isSelected = selectedCode === prod.code;
              return (
                <tr
                  key={prod.code}
                  onClick={() => onSelect(prod)}
                  className={`cursor-pointer transition ${
                    isSelected ? "bg-sky-500/15" : "hover:bg-slate-800/40"
                  }`}
                >
                  <td className="py-2.5 pr-3 font-mono font-semibold text-sky-300">
                    {prod.code}
                  </td>
                  <td className="py-2.5 pr-3 text-slate-200">{prod.name}</td>
                  <td
                    className={`py-2.5 pr-3 text-right font-bold tabular-nums ${
                      prod.stock <= 0
                        ? "text-rose-400"
                        : isLow
                          ? "text-amber-300"
                          : "text-emerald-300"
                    }`}
                  >
                    {prod.stock}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-slate-300">
                    {prod.ubicacion || "—"}
                  </td>
                  <td className="py-2.5 font-mono text-slate-400">
                    {prod.cod_barras || "—"}
                  </td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  Sin productos que coincidan con "{query}".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
