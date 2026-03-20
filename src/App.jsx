import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "sistema_ahorro_personal_v3";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200";
const cardClass =
  "rounded-2xl border border-white/60 bg-white/80 p-5 shadow-[0_10px_35px_-20px_rgba(15,23,42,0.45)] backdrop-blur";

const initialMonthState = {
  ahorroGeneral: { inicial: 0, aportes: [] },
  metas: [],
  porCobrar: [],
  deudas: [],
  gastos: [],
};

const initialState = {
  months: {},
};

function formatMoney(value) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function getMetaTotal(meta) {
  return Number(meta.inicial || 0) + meta.aportes.reduce((acc, item) => acc + Number(item.monto || 0), 0);
}

function toDateOnly(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDueStatus(dateValue) {
  const due = toDateOnly(dateValue);
  if (!due) return "sin_fecha";

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endWeek = new Date(startToday);
  endWeek.setDate(startToday.getDate() + 7);

  if (due < startToday) return "vencido";
  if (due.getTime() === startToday.getTime()) return "hoy";
  if (due <= endWeek) return "semana";
  return "futuro";
}

function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function getMonthKeysUpTo(monthsMap, targetMonth) {
  return Object.keys(monthsMap)
    .filter((key) => key <= targetMonth)
    .sort();
}

function ensureMonthShape(value) {
  return {
    ...initialMonthState,
    ...value,
    ahorroGeneral: {
      ...initialMonthState.ahorroGeneral,
      ...(value?.ahorroGeneral || {}),
      aportes: Array.isArray(value?.ahorroGeneral?.aportes) ? value.ahorroGeneral.aportes : [],
    },
    metas: Array.isArray(value?.metas) ? value.metas : [],
    porCobrar: Array.isArray(value?.porCobrar) ? value.porCobrar : [],
    deudas: Array.isArray(value?.deudas) ? value.deudas : [],
    gastos: Array.isArray(value?.gastos) ? value.gastos : [],
  };
}

function mapV2ToV3(oldData) {
  const monthKey = getCurrentMonthKey();
  return {
    months: {
      [monthKey]: ensureMonthShape(oldData),
    },
  };
}

function mapV1ToV3(oldData) {
  if (!oldData || !oldData.ahorro) return initialState;
  const ahorroViejo = oldData.ahorro;
  const metaMigrada = ahorroViejo.meta
    ? [
        {
          id: crypto.randomUUID(),
          nombre: ahorroViejo.meta,
          descripcion: ahorroViejo.descripcion || "",
          objetivo: Number(ahorroViejo.objetivo || 0),
          inicial: Number(ahorroViejo.inicial || 0),
          fechaObjetivo: ahorroViejo.fechaObjetivo || "",
          aportes: [],
        },
      ]
    : [];

  const monthPayload = ensureMonthShape({
    ahorroGeneral: {
      inicial: Number(ahorroViejo.inicial || 0),
      aportes: Array.isArray(ahorroViejo.aportes) ? ahorroViejo.aportes : [],
    },
    metas: metaMigrada,
    porCobrar: Array.isArray(oldData.porCobrar)
      ? oldData.porCobrar.map((item) => ({
          ...item,
          fechaCreacion: item.fechaCreacion || item.fecha || "",
          fechaCobro: item.fechaCobro || "",
        }))
      : [],
    deudas: Array.isArray(oldData.deudas)
      ? oldData.deudas.map((item) => ({
          ...item,
          fechaCreacion: item.fechaCreacion || item.fecha || "",
          fechaPago: item.fechaPago || "",
        }))
      : [],
  });

  return { months: { [getCurrentMonthKey()]: monthPayload } };
}

function getInitialData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.months) {
        const normalizedMonths = Object.fromEntries(
          Object.entries(parsed.months).map(([key, value]) => [key, ensureMonthShape(value)]),
        );
        return { months: normalizedMonths };
      }
    }
    const v2 = localStorage.getItem("sistema_ahorro_personal_v2");
    if (v2) return mapV2ToV3(JSON.parse(v2));
    const old = localStorage.getItem("sistema_ahorro_personal_v1");
    if (old) return mapV1ToV3(JSON.parse(old));
  } catch {
    return initialState;
  }
  return initialState;
}

function App() {
  const [tab, setTab] = useState("ahorro");
  const [data, setData] = useState(getInitialData);
  const [online, setOnline] = useState(navigator.onLine);
  const [monthKey, setMonthKey] = useState(getCurrentMonthKey());
  const [filtroCobrar, setFiltroCobrar] = useState("todos");
  const [filtroDeudas, setFiltroDeudas] = useState("todos");

  const [aporteGeneralMonto, setAporteGeneralMonto] = useState("");
  const [aporteGeneralNota, setAporteGeneralNota] = useState("");

  const [metaNombre, setMetaNombre] = useState("");
  const [metaDescripcion, setMetaDescripcion] = useState("");
  const [metaObjetivo, setMetaObjetivo] = useState("");
  const [metaInicial, setMetaInicial] = useState("");
  const [metaFechaObjetivo, setMetaFechaObjetivo] = useState("");

  const [metaAporte, setMetaAporte] = useState({});

  const [cobrarPersona, setCobrarPersona] = useState("");
  const [cobrarConcepto, setCobrarConcepto] = useState("");
  const [cobrarMonto, setCobrarMonto] = useState("");
  const [cobrarFechaCreacion, setCobrarFechaCreacion] = useState("");
  const [cobrarFechaCobro, setCobrarFechaCobro] = useState("");

  const [deudaPersona, setDeudaPersona] = useState("");
  const [deudaConcepto, setDeudaConcepto] = useState("");
  const [deudaMonto, setDeudaMonto] = useState("");
  const [deudaFechaCreacion, setDeudaFechaCreacion] = useState("");
  const [deudaFechaPago, setDeudaFechaPago] = useState("");
  const [gastoConcepto, setGastoConcepto] = useState("");
  const [gastoCategoria, setGastoCategoria] = useState("");
  const [gastoMonto, setGastoMonto] = useState("");
  const [gastoFecha, setGastoFecha] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  useEffect(() => {
    setData((prev) => {
      if (prev.months[monthKey]) return prev;
      return {
        ...prev,
        months: {
          ...prev.months,
          [monthKey]: ensureMonthShape({}),
        },
      };
    });
  }, [monthKey]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const monthData = useMemo(
    () => ensureMonthShape(data.months[monthKey] || {}),
    [data.months, monthKey],
  );
  const monthKeysUpToCurrent = useMemo(
    () => getMonthKeysUpTo(data.months, monthKey),
    [data.months, monthKey],
  );
  const porCobrarArrastrado = useMemo(() => {
    return monthKeysUpToCurrent.flatMap((key) => {
      const list = ensureMonthShape(data.months[key]).porCobrar;
      return list
        .filter((item) => key === monthKey || !item.pagado)
        .map((item) => ({ ...item, _sourceMonth: key }));
    });
  }, [data.months, monthKey, monthKeysUpToCurrent]);
  const deudasArrastradas = useMemo(() => {
    return monthKeysUpToCurrent.flatMap((key) => {
      const list = ensureMonthShape(data.months[key]).deudas;
      return list
        .filter((item) => key === monthKey || !item.pagado)
        .map((item) => ({ ...item, _sourceMonth: key }));
    });
  }, [data.months, monthKey, monthKeysUpToCurrent]);
  const metasGlobales = useMemo(() => {
    return Object.keys(data.months)
      .sort()
      .flatMap((key) =>
        ensureMonthShape(data.months[key]).metas.map((meta) => ({
          ...meta,
          _sourceMonth: key,
        })),
      );
  }, [data.months]);

  const totalAhorroGeneral = useMemo(
    () =>
      Number(monthData.ahorroGeneral.inicial || 0) +
      monthData.ahorroGeneral.aportes.reduce((acc, item) => acc + Number(item.monto || 0), 0),
    [monthData.ahorroGeneral],
  );
  const totalAhorroHistorico = useMemo(
    () =>
      Object.values(data.months).reduce((total, monthValue) => {
        const month = ensureMonthShape(monthValue);
        const monthTotal =
          Number(month.ahorroGeneral.inicial || 0) +
          month.ahorroGeneral.aportes.reduce((acc, item) => acc + Number(item.monto || 0), 0);
        return total + monthTotal;
      }, 0),
    [data.months],
  );
  const totalPorCobrar = useMemo(
    () =>
      porCobrarArrastrado.filter((item) => !item.pagado).reduce((acc, item) => acc + Number(item.monto || 0), 0),
    [porCobrarArrastrado],
  );
  const totalDeudas = useMemo(
    () =>
      deudasArrastradas.filter((item) => !item.pagado).reduce((acc, item) => acc + Number(item.monto || 0), 0),
    [deudasArrastradas],
  );
  const totalGastos = useMemo(
    () => monthData.gastos.reduce((acc, item) => acc + Number(item.monto || 0), 0),
    [monthData.gastos],
  );

  function updateMonthData(updater) {
    setData((prev) => {
      const current = ensureMonthShape(prev.months[monthKey] || {});
      const nextMonth = updater(current);
      return {
        ...prev,
        months: {
          ...prev.months,
          [monthKey]: ensureMonthShape(nextMonth),
        },
      };
    });
  }

  function registrarMovimientoGeneral(tipo) {
    const valor = Number(aporteGeneralMonto || 0);
    if (!valor) return;
    const totalActual =
      Number(monthData.ahorroGeneral.inicial || 0) +
      monthData.ahorroGeneral.aportes.reduce((acc, item) => acc + Number(item.monto || 0), 0);
    const monto = tipo === "retiro" ? -Math.abs(valor) : Math.abs(valor);
    if (tipo === "retiro" && totalActual + monto < 0) {
      alert("No puedes retirar mas de lo ahorrado en ahorro general.");
      return;
    }
    updateMonthData((prev) => ({
      ...prev,
      ahorroGeneral: {
        ...prev.ahorroGeneral,
        aportes: [
          {
            id: crypto.randomUUID(),
            monto,
            nota: aporteGeneralNota,
            tipo,
            fecha: new Date().toISOString(),
          },
          ...prev.ahorroGeneral.aportes,
        ],
      },
    }));
    setAporteGeneralMonto("");
    setAporteGeneralNota("");
  }

  function crearMeta(e) {
    e.preventDefault();
    if (!metaNombre || !metaObjetivo) return;
    updateMonthData((prev) => ({
      ...prev,
      metas: [
        {
          id: crypto.randomUUID(),
          nombre: metaNombre,
          descripcion: metaDescripcion,
          objetivo: Number(metaObjetivo),
          inicial: Number(metaInicial || 0),
          fechaObjetivo: metaFechaObjetivo,
          aportes: [],
        },
        ...prev.metas,
      ],
    }));
    setMetaNombre("");
    setMetaDescripcion("");
    setMetaObjetivo("");
    setMetaInicial("");
    setMetaFechaObjetivo("");
  }

  function registrarMovimientoMeta(metaId, tipo) {
    const valor = Number(metaAporte[metaId] || 0);
    if (!valor) return;
    const metaActual = metasGlobales.find((item) => item.id === metaId);
    if (!metaActual) return;
    const monto = tipo === "retiro" ? -Math.abs(valor) : Math.abs(valor);
    if (tipo === "retiro" && getMetaTotal(metaActual) + monto < 0) {
      alert("No puedes retirar mas de lo que tiene esta meta.");
      return;
    }
    setData((prev) => {
      const nextMonths = { ...prev.months };
      for (const key of Object.keys(nextMonths)) {
        const month = ensureMonthShape(nextMonths[key]);
        if (month.metas.some((meta) => meta.id === metaId)) {
          nextMonths[key] = {
            ...month,
            metas: month.metas.map((meta) =>
              meta.id === metaId
                ? {
                    ...meta,
                    aportes: [
                      { id: crypto.randomUUID(), monto, tipo, fecha: new Date().toISOString() },
                      ...meta.aportes,
                    ],
                  }
                : meta,
            ),
          };
          break;
        }
      }
      return { ...prev, months: nextMonths };
    });
    setMetaAporte((prev) => ({ ...prev, [metaId]: "" }));
  }

  function eliminarMeta(id) {
    setData((prev) => {
      const nextMonths = { ...prev.months };
      for (const key of Object.keys(nextMonths)) {
        const month = ensureMonthShape(nextMonths[key]);
        if (month.metas.some((item) => item.id === id)) {
          nextMonths[key] = {
            ...month,
            metas: month.metas.filter((item) => item.id !== id),
          };
          break;
        }
      }
      return { ...prev, months: nextMonths };
    });
  }

  function agregarPorCobrar(e) {
    e.preventDefault();
    if (!cobrarPersona || !cobrarMonto) return;
    updateMonthData((prev) => ({
      ...prev,
      porCobrar: [
        {
          id: crypto.randomUUID(),
          persona: cobrarPersona,
          concepto: cobrarConcepto,
          monto: Number(cobrarMonto),
          fechaCreacion: cobrarFechaCreacion,
          fechaCobro: cobrarFechaCobro,
          pagado: false,
        },
        ...prev.porCobrar,
      ],
    }));
    setCobrarPersona("");
    setCobrarConcepto("");
    setCobrarMonto("");
    setCobrarFechaCreacion("");
    setCobrarFechaCobro("");
  }

  function agregarDeuda(e) {
    e.preventDefault();
    if (!deudaPersona || !deudaMonto) return;
    updateMonthData((prev) => ({
      ...prev,
      deudas: [
        {
          id: crypto.randomUUID(),
          persona: deudaPersona,
          concepto: deudaConcepto,
          monto: Number(deudaMonto),
          fechaCreacion: deudaFechaCreacion,
          fechaPago: deudaFechaPago,
          pagado: false,
        },
        ...prev.deudas,
      ],
    }));
    setDeudaPersona("");
    setDeudaConcepto("");
    setDeudaMonto("");
    setDeudaFechaCreacion("");
    setDeudaFechaPago("");
  }

  function toggleEstado(tipo, id) {
    if (tipo === "porCobrar" || tipo === "deudas") {
      setData((prev) => {
        const nextMonths = { ...prev.months };
        for (const key of Object.keys(nextMonths)) {
          const month = ensureMonthShape(nextMonths[key]);
          if (month[tipo].some((item) => item.id === id)) {
            nextMonths[key] = {
              ...month,
              [tipo]: month[tipo].map((item) =>
                item.id === id ? { ...item, pagado: !item.pagado } : item,
              ),
            };
            break;
          }
        }
        return { ...prev, months: nextMonths };
      });
      return;
    }

    updateMonthData((prev) => ({
      ...prev,
      [tipo]: prev[tipo].map((item) => (item.id === id ? { ...item, pagado: !item.pagado } : item)),
    }));
  }

  function eliminarRegistro(tipo, id) {
    if (tipo === "porCobrar" || tipo === "deudas") {
      setData((prev) => {
        const nextMonths = { ...prev.months };
        for (const key of Object.keys(nextMonths)) {
          const month = ensureMonthShape(nextMonths[key]);
          if (month[tipo].some((item) => item.id === id)) {
            nextMonths[key] = {
              ...month,
              [tipo]: month[tipo].filter((item) => item.id !== id),
            };
            break;
          }
        }
        return { ...prev, months: nextMonths };
      });
      return;
    }

    updateMonthData((prev) => ({ ...prev, [tipo]: prev[tipo].filter((item) => item.id !== id) }));
  }

  function agregarGasto(e) {
    e.preventDefault();
    if (!gastoConcepto || !gastoMonto) return;
    updateMonthData((prev) => ({
      ...prev,
      gastos: [
        {
          id: crypto.randomUUID(),
          concepto: gastoConcepto,
          categoria: gastoCategoria,
          monto: Number(gastoMonto),
          fecha: gastoFecha,
        },
        ...prev.gastos,
      ],
    }));
    setGastoConcepto("");
    setGastoCategoria("");
    setGastoMonto("");
    setGastoFecha("");
  }

  function exportarRespaldo() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `respaldo-ahorro-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importarRespaldo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        const imported = parsed?.data;
        if (!imported || typeof imported !== "object") {
          alert("Archivo invalido.");
          return;
        }
        setData({
          ...initialState,
          ...imported,
        });
        alert("Respaldo importado correctamente.");
      } catch {
        alert("No se pudo leer el respaldo.");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  const porCobrarFiltrado = useMemo(() => {
    return porCobrarArrastrado.filter((item) => {
      if (filtroCobrar === "todos") return true;
      if (item.pagado) return false;
      const status = getDueStatus(item.fechaCobro);
      if (filtroCobrar === "hoy") return status === "hoy";
      if (filtroCobrar === "semana") return status === "semana";
      if (filtroCobrar === "vencido") return status === "vencido";
      return true;
    });
  }, [porCobrarArrastrado, filtroCobrar]);

  const deudasFiltradas = useMemo(() => {
    return deudasArrastradas.filter((item) => {
      if (filtroDeudas === "todos") return true;
      if (item.pagado) return false;
      const status = getDueStatus(item.fechaPago);
      if (filtroDeudas === "hoy") return status === "hoy";
      if (filtroDeudas === "semana") return status === "semana";
      if (filtroDeudas === "vencido") return status === "vencido";
      return true;
    });
  }, [deudasArrastradas, filtroDeudas]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 via-indigo-50/40 to-slate-100 p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 p-6 text-white shadow-xl">
          <h1 className="text-2xl font-bold md:text-3xl">Sistema de ahorro</h1>
          <p className="mt-2 max-w-2xl text-sm text-indigo-100">
            Realiza tus ahorros, cobros y deudas.
          </p>
          <p className={`mt-3 inline-block rounded-lg px-3 py-1 text-xs ${online ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"}`}>
            {online ? "En linea" : "Sin conexion - datos locales activos"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={exportarRespaldo}
              className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30"
            >
              Exportar respaldo JSON
            </button>
            <label className="cursor-pointer rounded-lg bg-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/30">
              Importar respaldo JSON
              <input type="file" accept="application/json" className="hidden" onChange={importarRespaldo} />
            </label>
          </div>
        </header>

        <section className={`${cardClass} flex flex-wrap items-end gap-3`}>
          <div>
            <p className="mb-1 text-xs text-slate-500">Mes de trabajo</p>
            <input
              type="month"
              value={monthKey}
              onChange={(e) => setMonthKey(e.target.value)}
              className={inputClass}
            />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-5">
          <div className={`${cardClass} border-emerald-100`}>
            <p className="text-xs uppercase tracking-wide text-slate-500">Ahorro del mes</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-600">{formatMoney(totalAhorroGeneral)}</p>
          </div>
          <div className={`${cardClass} border-teal-100`}>
            <p className="text-xs uppercase tracking-wide text-slate-500">Ahorro total historico</p>
            <p className="mt-2 text-2xl font-semibold text-teal-600">{formatMoney(totalAhorroHistorico)}</p>
          </div>
          <div className={`${cardClass} border-blue-100`}>
            <p className="text-xs uppercase tracking-wide text-slate-500">Por cobrar</p>
            <p className="mt-2 text-2xl font-semibold text-blue-600">{formatMoney(totalPorCobrar)}</p>
          </div>
          <div className={`${cardClass} border-rose-100`}>
            <p className="text-xs uppercase tracking-wide text-slate-500">Deudas</p>
            <p className="mt-2 text-2xl font-semibold text-rose-600">{formatMoney(totalDeudas)}</p>
          </div>
          <div className={`${cardClass} border-amber-100`}>
            <p className="text-xs uppercase tracking-wide text-slate-500">Gastos del mes</p>
            <p className="mt-2 text-2xl font-semibold text-amber-600">{formatMoney(totalGastos)}</p>
          </div>
        </section>

        <nav className={`${cardClass} grid grid-cols-4 gap-2 p-2`}>
          {[
            ["ahorro", "Ahorro"],
            ["porCobrar", "Por cobrar"],
            ["deudas", "Deudas"],
            ["gastos", "Gastos"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
                tab === key ? "bg-slate-900 text-white shadow-md" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "ahorro" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={cardClass}>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Ahorro general (aparte de metas)</h2>
              <div className="space-y-3">
                <input className={inputClass} type="number" min="0" placeholder="Monto del aporte" value={aporteGeneralMonto} onChange={(e) => setAporteGeneralMonto(e.target.value)} />
                <input className={inputClass} placeholder="Nota (opcional)" value={aporteGeneralNota} onChange={(e) => setAporteGeneralNota(e.target.value)} />
                <div className="flex gap-2">
                  <button onClick={() => registrarMovimientoGeneral("aporte")} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500">Agregar aporte</button>
                  <button onClick={() => registrarMovimientoGeneral("retiro")} className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-500">Retirar</button>
                </div>
              </div>
            </article>

            <article className={cardClass}>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Crear ahorro programado</h2>
              <form className="space-y-3" onSubmit={crearMeta}>
                <input className={inputClass} placeholder="Nombre meta (ej. Moto)" value={metaNombre} onChange={(e) => setMetaNombre(e.target.value)} />
                <textarea className={inputClass} rows={2} placeholder="Descripcion" value={metaDescripcion} onChange={(e) => setMetaDescripcion(e.target.value)} />
                <div className="grid gap-3 md:grid-cols-2">
                  <input className={inputClass} type="number" min="0" placeholder="Objetivo" value={metaObjetivo} onChange={(e) => setMetaObjetivo(e.target.value)} />
                  <input className={inputClass} type="number" min="0" placeholder="Inicial (opcional)" value={metaInicial} onChange={(e) => setMetaInicial(e.target.value)} />
                </div>
                <input className={inputClass} type="date" value={metaFechaObjetivo} onChange={(e) => setMetaFechaObjetivo(e.target.value)} />
                <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700">Guardar meta</button>
              </form>
            </article>

            <article className={`${cardClass} lg:col-span-2`}>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Metas programadas</h2>
              <div className="space-y-3">
                {metasGlobales.length === 0 && <p className="text-sm text-slate-500">No has creado metas programadas.</p>}
                {metasGlobales.map((meta) => {
                  const totalMeta = getMetaTotal(meta);
                  const porcentaje = meta.objetivo ? Math.min((totalMeta / Number(meta.objetivo)) * 100, 100) : 0;
                  const completada = porcentaje >= 100;
                  return (
                    <div key={meta.id} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-semibold text-slate-900">{meta.nombre}</p>
                          <p className="text-xs text-slate-500">{meta.descripcion || "Sin descripcion"}</p>
                        </div>
                        <button onClick={() => eliminarMeta(meta.id)} className="rounded-lg bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-200">
                          Borrar meta
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {formatMoney(totalMeta)} de {formatMoney(meta.objetivo)} {meta.fechaObjetivo ? `- Fecha objetivo: ${meta.fechaObjetivo}` : ""}
                      </p>
                      <p className="text-xs text-slate-500">Mes origen: {meta._sourceMonth}</p>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                        <div className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400" style={{ width: `${porcentaje}%` }} />
                      </div>
                      <p className={`mt-1 text-xs font-medium ${completada ? "text-emerald-700" : "text-indigo-700"}`}>
                        {porcentaje.toFixed(1)}% {completada ? "- Meta completada" : ""}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <input
                          className={`${inputClass} !py-2`}
                          type="number"
                          min="0"
                          placeholder="Aporte meta"
                          value={metaAporte[meta.id] || ""}
                          onChange={(e) => setMetaAporte((prev) => ({ ...prev, [meta.id]: e.target.value }))}
                        />
                        <button onClick={() => registrarMovimientoMeta(meta.id, "aporte")} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                          Aportar
                        </button>
                        <button onClick={() => registrarMovimientoMeta(meta.id, "retiro")} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">
                          Retirar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          </section>
        )}

        {tab === "porCobrar" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={cardClass}>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Agregar por cobrar</h2>
              <form className="space-y-3" onSubmit={agregarPorCobrar}>
                <input className={inputClass} placeholder="Persona o cliente" value={cobrarPersona} onChange={(e) => setCobrarPersona(e.target.value)} />
                <input className={inputClass} placeholder="Trabajo/tarea/concepto" value={cobrarConcepto} onChange={(e) => setCobrarConcepto(e.target.value)} />
                <input className={inputClass} type="number" min="0" placeholder="Monto" value={cobrarMonto} onChange={(e) => setCobrarMonto(e.target.value)} />
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs text-slate-500">Fecha realizada</p>
                    <input className={inputClass} type="date" value={cobrarFechaCreacion} onChange={(e) => setCobrarFechaCreacion(e.target.value)} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-500">Fecha para cobrar</p>
                    <input className={inputClass} type="date" value={cobrarFechaCobro} onChange={(e) => setCobrarFechaCobro(e.target.value)} />
                  </div>
                </div>
                <button className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500">Agregar</button>
              </form>
            </article>
            <article className={cardClass}>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Listado por cobrar</h2>
              <div className="mb-3">
                <select
                  className={inputClass}
                  value={filtroCobrar}
                  onChange={(e) => setFiltroCobrar(e.target.value)}
                >
                  <option value="todos">Filtrar: Todos</option>
                  <option value="hoy">Vence hoy</option>
                  <option value="semana">Vence esta semana</option>
                  <option value="vencido">Vencidos</option>
                </select>
              </div>
              <div className="space-y-2">
                {porCobrarFiltrado.length === 0 && <p className="text-sm text-slate-500">No tienes cuentas por cobrar para este filtro.</p>}
                {porCobrarFiltrado.map((item) => {
                  const dueStatus = item.pagado ? "pagado" : getDueStatus(item.fechaCobro);
                  const statusClass =
                    dueStatus === "vencido"
                      ? "bg-rose-100 text-rose-700"
                      : dueStatus === "hoy"
                        ? "bg-amber-100 text-amber-700"
                        : dueStatus === "semana"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-600";
                  const statusLabel =
                    dueStatus === "pagado"
                      ? "Pagado"
                      : dueStatus === "vencido"
                        ? "Vencido"
                        : dueStatus === "hoy"
                          ? "Vence hoy"
                          : dueStatus === "semana"
                            ? "Vence esta semana"
                            : "Sin alerta";
                  return (
                  <div key={item.id} className={`rounded-xl border bg-white p-3 ${dueStatus === "vencido" ? "border-rose-300" : "border-slate-200"}`}>
                    <p className="font-medium text-slate-900">{item.persona}</p>
                    <p className="text-sm text-slate-600">{item.concepto || "Sin concepto"}</p>
                    <p className="text-sm font-semibold text-blue-700">{formatMoney(item.monto)}</p>
                    <p className="text-xs text-slate-500">Mes origen: {item._sourceMonth} | Realizada: {item.fechaCreacion || "No definida"} | Cobro: {item.fechaCobro || "No definida"}</p>
                    <span className={`mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium ${statusClass}`}>
                      {statusLabel}
                    </span>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => toggleEstado("porCobrar", item.id)} className={`rounded-xl px-3 py-1.5 text-sm text-white ${item.pagado ? "bg-slate-400 hover:bg-slate-500" : "bg-emerald-600 hover:bg-emerald-500"}`}>
                        {item.pagado ? "Marcar pendiente" : "Marcar cobrado"}
                      </button>
                      <button onClick={() => eliminarRegistro("porCobrar", item.id)} className="rounded-xl bg-rose-100 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-200">
                        Borrar
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            </article>
          </section>
        )}

        {tab === "deudas" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={cardClass}>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Agregar deuda</h2>
              <form className="space-y-3" onSubmit={agregarDeuda}>
                <input className={inputClass} placeholder="Persona o entidad" value={deudaPersona} onChange={(e) => setDeudaPersona(e.target.value)} />
                <input className={inputClass} placeholder="Concepto de la deuda" value={deudaConcepto} onChange={(e) => setDeudaConcepto(e.target.value)} />
                <input className={inputClass} type="number" min="0" placeholder="Monto" value={deudaMonto} onChange={(e) => setDeudaMonto(e.target.value)} />
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs text-slate-500">Fecha realizada</p>
                    <input className={inputClass} type="date" value={deudaFechaCreacion} onChange={(e) => setDeudaFechaCreacion(e.target.value)} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-500">Fecha para pagar</p>
                    <input className={inputClass} type="date" value={deudaFechaPago} onChange={(e) => setDeudaFechaPago(e.target.value)} />
                  </div>
                </div>
                <button className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-rose-500">Agregar</button>
              </form>
            </article>
            <article className={cardClass}>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Listado de deudas</h2>
              <div className="mb-3">
                <select
                  className={inputClass}
                  value={filtroDeudas}
                  onChange={(e) => setFiltroDeudas(e.target.value)}
                >
                  <option value="todos">Filtrar: Todas</option>
                  <option value="hoy">Vencen hoy</option>
                  <option value="semana">Vencen esta semana</option>
                  <option value="vencido">Vencidas</option>
                </select>
              </div>
              <div className="space-y-2">
                {deudasFiltradas.length === 0 && <p className="text-sm text-slate-500">No tienes deudas para este filtro.</p>}
                {deudasFiltradas.map((item) => {
                  const dueStatus = item.pagado ? "pagado" : getDueStatus(item.fechaPago);
                  const statusClass =
                    dueStatus === "vencido"
                      ? "bg-rose-100 text-rose-700"
                      : dueStatus === "hoy"
                        ? "bg-amber-100 text-amber-700"
                        : dueStatus === "semana"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-600";
                  const statusLabel =
                    dueStatus === "pagado"
                      ? "Pagada"
                      : dueStatus === "vencido"
                        ? "Vencida"
                        : dueStatus === "hoy"
                          ? "Vence hoy"
                          : dueStatus === "semana"
                            ? "Vence esta semana"
                            : "Sin alerta";
                  return (
                  <div key={item.id} className={`rounded-xl border bg-white p-3 ${dueStatus === "vencido" ? "border-rose-300" : "border-slate-200"}`}>
                    <p className="font-medium text-slate-900">{item.persona}</p>
                    <p className="text-sm text-slate-600">{item.concepto || "Sin concepto"}</p>
                    <p className="text-sm font-semibold text-rose-700">{formatMoney(item.monto)}</p>
                    <p className="text-xs text-slate-500">Mes origen: {item._sourceMonth} | Realizada: {item.fechaCreacion || "No definida"} | Pago: {item.fechaPago || "No definida"}</p>
                    <span className={`mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium ${statusClass}`}>
                      {statusLabel}
                    </span>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => toggleEstado("deudas", item.id)} className={`rounded-xl px-3 py-1.5 text-sm text-white ${item.pagado ? "bg-slate-400 hover:bg-slate-500" : "bg-emerald-600 hover:bg-emerald-500"}`}>
                        {item.pagado ? "Marcar pendiente" : "Marcar pagada"}
                      </button>
                      <button onClick={() => eliminarRegistro("deudas", item.id)} className="rounded-xl bg-rose-100 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-200">
                        Borrar
                      </button>
                    </div>
                  </div>
                )})}
              </div>
            </article>
          </section>
        )}

        {tab === "gastos" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={cardClass}>
              <h2 className="mb-4 text-lg font-semibold text-slate-900">Registrar gasto del mes</h2>
              <form className="space-y-3" onSubmit={agregarGasto}>
                <input className={inputClass} placeholder="Concepto" value={gastoConcepto} onChange={(e) => setGastoConcepto(e.target.value)} />
                <input className={inputClass} placeholder="Categoria (ej. Transporte)" value={gastoCategoria} onChange={(e) => setGastoCategoria(e.target.value)} />
                <input className={inputClass} type="number" min="0" placeholder="Monto" value={gastoMonto} onChange={(e) => setGastoMonto(e.target.value)} />
                <input className={inputClass} type="date" value={gastoFecha} onChange={(e) => setGastoFecha(e.target.value)} />
                <button className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-500">Agregar gasto</button>
              </form>
            </article>
            <article className={cardClass}>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Listado de gastos</h2>
              <div className="space-y-2">
                {monthData.gastos.length === 0 && <p className="text-sm text-slate-500">No hay gastos en este mes.</p>}
                {monthData.gastos.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <p className="font-medium text-slate-900">{item.concepto}</p>
                    <p className="text-sm text-slate-600">{item.categoria || "Sin categoria"}</p>
                    <p className="text-sm font-semibold text-amber-700">{formatMoney(item.monto)}</p>
                    <p className="text-xs text-slate-500">Fecha: {item.fecha || "No definida"}</p>
                    <button onClick={() => eliminarRegistro("gastos", item.id)} className="mt-2 rounded-xl bg-rose-100 px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-200">Borrar</button>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

      </div>
    </main>
  );
}

export default App;
