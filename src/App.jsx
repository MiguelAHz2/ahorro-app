import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

const STORAGE_KEY = "sistema_ahorro_personal_v3";

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

function getPagadoMonto(item) {
  const abonos = Array.isArray(item?.abonos) ? item.abonos : [];
  return abonos.reduce((acc, x) => acc + Number(x?.monto || 0), 0);
}

function getSaldoPendiente(item) {
  const total = Number(item?.monto || 0);
  const pagado = getPagadoMonto(item);
  return Math.max(total - pagado, 0);
}

function getPagadoMontoHasta(item, monthKey) {
  const abonos = Array.isArray(item?.abonos) ? item.abonos : [];
  // Asumimos que `abono.fecha` tiene formato ISO, por lo que `slice(0, 7)` da YYYY-MM.
  const pagado = abonos
    .filter((a) => (a?.fecha ? a.fecha.slice(0, 7) <= monthKey : false))
    .reduce((acc, x) => acc + Number(x?.monto || 0), 0);

  // Compatibilidad: si existía solo `pagado: true` y no había abonos.
  if ((!abonos || abonos.length === 0) && item?.pagado) return Number(item?.monto || 0);

  return pagado;
}

function getSaldoPendienteHasta(item, monthKey) {
  const total = Number(item?.monto || 0);
  const pagadoHasta = getPagadoMontoHasta(item, monthKey);
  return Math.max(total - pagadoHasta, 0);
}

function getMetaTotalHasta(meta, monthKey) {
  const base = Number(meta?.inicial || 0);
  const aportes = Array.isArray(meta?.aportes) ? meta.aportes : [];
  const suma = aportes
    .filter((a) => (a?.fecha ? a.fecha.slice(0, 7) <= monthKey : false))
    .reduce((acc, a) => acc + Number(a?.monto || 0), 0);
  return base + suma;
}

function getAhorroGeneralHasta(monthKey, monthsMap) {
  return Object.keys(monthsMap || {})
    .filter((k) => k <= monthKey)
    .reduce((acc, k) => {
      const m = ensureMonthShape(monthsMap[k]);
      const base = Number(m.ahorroGeneral?.inicial || 0);
      const aportes = (m.ahorroGeneral?.aportes || []).reduce(
        (s, x) => s + Number(x?.monto || 0),
        0,
      );
      return acc + base + aportes;
    }, 0);
}

function getGastosHasta(monthKey, monthsMap) {
  return Object.keys(monthsMap || {})
    .filter((k) => k <= monthKey)
    .reduce((acc, k) => {
      const m = ensureMonthShape(monthsMap[k]);
      return acc + m.gastos.reduce((s, g) => s + Number(g?.monto || 0), 0);
    }, 0);
}

function migrarAbonos(items, montoFecha) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const montoTotal = Number(item?.monto || 0);
    const abonosExistentes = Array.isArray(item?.abonos) ? item.abonos : null;

    const abonosNormalizados = abonosExistentes
      ? abonosExistentes.map((a) => ({
          id: a?.id || crypto.randomUUID(),
          monto: Number(a?.monto || 0),
          fecha: a?.fecha || new Date().toISOString(),
          nota: a?.nota || "",
        }))
      : item?.pagado
        ? [
            {
              id: crypto.randomUUID(),
              monto: montoTotal,
              fecha: item?.[montoFecha] || new Date().toISOString(),
              nota: "",
            },
          ]
        : [];

    const nextItem = {
      ...item,
      abonos: abonosNormalizados,
    };
    nextItem.pagado = getSaldoPendiente(nextItem) <= 0 && montoTotal > 0;
    return nextItem;
  });
}

function migrarMesPagos(month) {
  const m = ensureMonthShape(month || {});
  return {
    ...m,
    porCobrar: migrarAbonos(m.porCobrar, "fechaCobro"),
    deudas: migrarAbonos(m.deudas, "fechaPago"),
  };
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
        const migratedMonths = Object.fromEntries(
          Object.entries(normalizedMonths).map(([key, monthValue]) => [
            key,
            migrarMesPagos(monthValue),
          ]),
        );
        return { months: migratedMonths };
      }
    }
    const v2 = localStorage.getItem("sistema_ahorro_personal_v2");
    if (v2) {
      const v2Parsed = mapV2ToV3(JSON.parse(v2));
      return {
        months: Object.fromEntries(
          Object.entries(v2Parsed.months).map(([key, monthValue]) => [key, migrarMesPagos(monthValue)]),
        ),
      };
    }
    const old = localStorage.getItem("sistema_ahorro_personal_v1");
    if (old) {
      const v1Parsed = mapV1ToV3(JSON.parse(old));
      return {
        months: Object.fromEntries(
          Object.entries(v1Parsed.months).map(([key, monthValue]) => [key, migrarMesPagos(monthValue)]),
        ),
      };
    }
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

  const [themeMode, setThemeMode] = useState(() => {
    const saved = localStorage.getItem("sistema_ahorro_theme_mode");
    return saved === "dark" ? "dark" : "light";
  });
  const isDark = themeMode === "dark";
  // Según tu requerimiento: en "Claro" el `header` debe verse oscuro, pero el resto de la app debe seguir siendo claro.
  const headerIsDark = true;

  // Clases generadas 100% desde `isDark` (evita inconsistencias por `dark:`)
  const inputClass = isDark
    ? "w-full rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2.5 text-sm text-slate-100 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-700/30"
    : "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200";

  const cardClass = isDark
    ? "rounded-2xl border border-slate-700 bg-slate-900/60 p-5 shadow-[0_10px_35px_-20px_rgba(15,23,42,0.35)] backdrop-blur"
    : "rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_35px_-20px_rgba(15,23,42,0.15)] backdrop-blur";

  useEffect(() => {
    localStorage.setItem("sistema_ahorro_theme_mode", themeMode);
  }, [themeMode]);

  useLayoutEffect(() => {
    const el = document.documentElement;
    if (isDark) el.classList.add("dark");
    else el.classList.remove("dark");
  }, [isDark]);

  // Nota: el modo claro/oscuro es manual (sin opción "sistema").

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
  const [abonoPorCobrar, setAbonoPorCobrar] = useState({});
  const [abonoDeudas, setAbonoDeudas] = useState({});
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
        .filter((item) => key === monthKey || getSaldoPendiente(item) > 0)
        .map((item) => ({ ...item, _sourceMonth: key }));
    });
  }, [data.months, monthKey, monthKeysUpToCurrent]);
  const deudasArrastradas = useMemo(() => {
    return monthKeysUpToCurrent.flatMap((key) => {
      const list = ensureMonthShape(data.months[key]).deudas;
      return list
        .filter((item) => key === monthKey || getSaldoPendiente(item) > 0)
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
      porCobrarArrastrado.reduce((acc, item) => acc + getSaldoPendiente(item), 0),
    [porCobrarArrastrado],
  );
  const totalDeudas = useMemo(
    () =>
      deudasArrastradas.reduce((acc, item) => acc + getSaldoPendiente(item), 0),
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
          abonos: [],
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
          abonos: [],
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
          const item = month[tipo].find((x) => x.id === id);
          if (!item) continue;
          const saldo = getSaldoPendiente(item);
          if (saldo <= 0) break;

          const abono = {
            id: crypto.randomUUID(),
            monto: saldo,
            fecha: new Date().toISOString(),
            nota: "",
          };

          nextMonths[key] = {
            ...month,
            [tipo]: month[tipo].map((x) =>
              x.id === id
                ? {
                    ...x,
                    abonos: [{ ...abono }, ...(Array.isArray(x.abonos) ? x.abonos : [])],
                    pagado: true,
                  }
                : x,
            ),
          };
          break;
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

  function abonarPorCobrar(id) {
    const amount = Number(abonoPorCobrar[id] || 0);
    if (!amount) return;

    const itemActual = porCobrarArrastrado.find((x) => x.id === id);
    if (!itemActual) return;
    const saldo = getSaldoPendiente(itemActual);
    if (amount > saldo) {
      alert(`El abono no puede ser mayor al saldo pendiente (${formatMoney(saldo)}).`);
      return;
    }

    setData((prev) => {
      const nextMonths = { ...prev.months };
      for (const key of Object.keys(nextMonths)) {
        const month = ensureMonthShape(nextMonths[key]);
        const item = month.porCobrar.find((x) => x.id === id);
        if (!item) continue;

        const saldo = getSaldoPendiente(item);
        if (saldo <= 0) break;

        const montoAbono = amount;
        const abono = {
          id: crypto.randomUUID(),
          monto: montoAbono,
          fecha: new Date().toISOString(),
          nota: "",
        };

        nextMonths[key] = {
          ...month,
          porCobrar: month.porCobrar.map((x) =>
            x.id === id
              ? {
                  ...x,
                  abonos: [{ ...abono }, ...(Array.isArray(x.abonos) ? x.abonos : [])],
                  pagado: getSaldoPendiente({
                    ...x,
                    abonos: [{ ...abono }, ...(Array.isArray(x.abonos) ? x.abonos : [])],
                  }) <= 0,
                }
              : x,
          ),
        };
        break;
      }
      return { ...prev, months: nextMonths };
    });

    setAbonoPorCobrar((prev) => ({ ...prev, [id]: "" }));
  }

  function abonarDeudas(id) {
    const amount = Number(abonoDeudas[id] || 0);
    if (!amount) return;

    const itemActual = deudasArrastradas.find((x) => x.id === id);
    if (!itemActual) return;
    const saldo = getSaldoPendiente(itemActual);
    if (amount > saldo) {
      alert(`El abono no puede ser mayor al saldo pendiente (${formatMoney(saldo)}).`);
      return;
    }

    setData((prev) => {
      const nextMonths = { ...prev.months };
      for (const key of Object.keys(nextMonths)) {
        const month = ensureMonthShape(nextMonths[key]);
        const item = month.deudas.find((x) => x.id === id);
        if (!item) continue;

        const saldo = getSaldoPendiente(item);
        if (saldo <= 0) break;

        const montoAbono = amount;
        const abono = {
          id: crypto.randomUUID(),
          monto: montoAbono,
          fecha: new Date().toISOString(),
          nota: "",
        };

        nextMonths[key] = {
          ...month,
          deudas: month.deudas.map((x) =>
            x.id === id
              ? {
                  ...x,
                  abonos: [{ ...abono }, ...(Array.isArray(x.abonos) ? x.abonos : [])],
                  pagado: getSaldoPendiente({
                    ...x,
                    abonos: [{ ...abono }, ...(Array.isArray(x.abonos) ? x.abonos : [])],
                  }) <= 0,
                }
              : x,
          ),
        };
        break;
      }
      return { ...prev, months: nextMonths };
    });

    setAbonoDeudas((prev) => ({ ...prev, [id]: "" }));
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
        const importedMonths = imported?.months || {};
        const migratedMonths = Object.fromEntries(
          Object.entries(importedMonths).map(([key, monthValue]) => [
            key,
            migrarMesPagos(monthValue),
          ]),
        );
        setData({
          ...initialState,
          ...imported,
          months: migratedMonths,
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

  function downloadXlsx(workbook, filename) {
    const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportarInformeMensual() {
    const mesesKeys = Object.keys(data.months || {}).sort();
    const keysHasta = mesesKeys.filter((k) => k <= monthKey);

    const metasUnicas = Array.from(new Map(metasGlobales.map((m) => [m.id, m])).values());

    const ahorroGeneralHasta = getAhorroGeneralHasta(monthKey, data.months);
    const ahorroMetasHasta = metasUnicas.reduce((acc, m) => acc + getMetaTotalHasta(m, monthKey), 0);
    const gastosAcumuladosHasta = getGastosHasta(monthKey, data.months);

    const porCobrarHasta = keysHasta.flatMap((k) =>
      ensureMonthShape(data.months[k]).porCobrar.map((item) => ({ ...item, _sourceMonth: k })),
    );
    const deudasHasta = keysHasta.flatMap((k) =>
      ensureMonthShape(data.months[k]).deudas.map((item) => ({ ...item, _sourceMonth: k })),
    );

    const porCobrarPendienteHasta = porCobrarHasta.reduce(
      (acc, item) => acc + getSaldoPendienteHasta(item, monthKey),
      0,
    );
    const deudasPendientesHasta = deudasHasta.reduce(
      (acc, item) => acc + getSaldoPendienteHasta(item, monthKey),
      0,
    );

    const balanceNetoHasta =
      ahorroGeneralHasta + ahorroMetasHasta + porCobrarPendienteHasta - deudasPendientesHasta - gastosAcumuladosHasta;

    const gastosMes = ensureMonthShape(data.months[monthKey] || {}).gastos.reduce(
      (s, g) => s + Number(g?.monto || 0),
      0,
    );

    const netAhorroGeneralMes = ensureMonthShape(data.months[monthKey] || {}).ahorroGeneral.aportes.reduce(
      (s, x) => s + Number(x?.monto || 0),
      0,
    );

    // Cobros y pagos ocurridos dentro del mes (por fecha de abono)
    const cobrosMes = porCobrarHasta.reduce((acc, item) => {
      const abonos = Array.isArray(item?.abonos) ? item.abonos : [];
      const suma = abonos
        .filter((a) => (a?.fecha ? a.fecha.slice(0, 7) === monthKey : false))
        .reduce((s, a) => s + Number(a?.monto || 0), 0);
      return acc + suma;
    }, 0);

    const pagosMes = deudasHasta.reduce((acc, item) => {
      const abonos = Array.isArray(item?.abonos) ? item.abonos : [];
      const suma = abonos
        .filter((a) => (a?.fecha ? a.fecha.slice(0, 7) === monthKey : false))
        .reduce((s, a) => s + Number(a?.monto || 0), 0);
      return acc + suma;
    }, 0);

    const flujoNetoMes = netAhorroGeneralMes + cobrosMes - pagosMes - gastosMes;

    const wsResumen = XLSX.utils.aoa_to_sheet([
      ["Informe mensual (snapshot)"],
      ["Mes", monthKey],
      [],
      ["Balance neto hasta el fin del mes (fórmula)"],
      ["Ahorro general acumulado", ahorroGeneralHasta],
      ["Ahorro en metas acumulado", ahorroMetasHasta],
      ["Por cobrar pendiente (al corte)", porCobrarPendienteHasta],
      ["Deudas pendientes (al corte)", deudasPendientesHasta],
      ["Gastos acumulados (hasta mes)", gastosAcumuladosHasta],
      ["Balance neto (fórmula)", "Ahorro general + Metas + Por cobrar - Deudas - Gastos"],
      ["Balance neto", balanceNetoHasta],
      [],
      ["Flujo del mes (solo movimientos dentro de este mes)"],
      ["Ahorro general neto del mes (aportes/retiros)", netAhorroGeneralMes],
      ["Cobros en el mes (abonos a por cobrar)", cobrosMes],
      ["Pagos en el mes (abonos a deudas)", pagosMes],
      ["Gastos del mes", gastosMes],
      ["Flujo neto aproximado", flujoNetoMes],
      [],
      ["Notas", "Saldos y balance usan abonos con fecha <= fin del mes seleccionado."],
    ]);

    const gastosDetalle = ensureMonthShape(data.months[monthKey] || {}).gastos.map((g) => [
      g.concepto || "",
      g.categoria || "",
      Number(g?.monto || 0),
      g.fecha || "",
    ]);

    const porCobrarDetalle = porCobrarHasta
      .map((item) => {
        const saldo = getSaldoPendienteHasta(item, monthKey);
        if (saldo <= 0) return null;
        const abonosHasta = (Array.isArray(item?.abonos) ? item.abonos : []).filter(
          (a) => a?.fecha && a.fecha.slice(0, 7) <= monthKey,
        );
        const ultimoAbono = abonosHasta
          .map((a) => a.fecha)
          .sort()
          .slice(-1)[0];
        const alerta = getDueStatus(item.fechaCobro);
        return [
          item.persona || "",
          item.concepto || "",
          Number(item?.monto || 0),
          saldo,
          item.fechaCreacion || "",
          item.fechaCobro || "",
          item._sourceMonth || "",
          alerta,
          abonosHasta.length,
          ultimoAbono || "",
        ];
      })
      .filter(Boolean);

    const deudasDetalle = deudasHasta
      .map((item) => {
        const saldo = getSaldoPendienteHasta(item, monthKey);
        if (saldo <= 0) return null;
        const abonosHasta = (Array.isArray(item?.abonos) ? item.abonos : []).filter(
          (a) => a?.fecha && a.fecha.slice(0, 7) <= monthKey,
        );
        const ultimoAbono = abonosHasta
          .map((a) => a.fecha)
          .sort()
          .slice(-1)[0];
        const alerta = getDueStatus(item.fechaPago);
        return [
          item.persona || "",
          item.concepto || "",
          Number(item?.monto || 0),
          saldo,
          item.fechaCreacion || "",
          item.fechaPago || "",
          item._sourceMonth || "",
          alerta,
          abonosHasta.length,
          ultimoAbono || "",
        ];
      })
      .filter(Boolean);

    const wsDetalle = XLSX.utils.aoa_to_sheet([
      ["Gastos del mes"],
      ["Concepto", "Categoria", "Monto", "Fecha"],
      ...gastosDetalle,
      [],
      ["Por cobrar pendientes (al corte)"],
      ["Persona", "Concepto", "Monto total", "Saldo al mes", "Fecha realizada", "Fecha cobro", "Mes origen", "Alerta", "Abonos hasta corte", "Ultimo abono"],
      ...porCobrarDetalle,
      [],
      ["Deudas pendientes (al corte)"],
      ["Persona", "Concepto", "Monto total", "Saldo al mes", "Fecha realizada", "Fecha pago", "Mes origen", "Alerta", "Abonos hasta corte", "Ultimo abono"],
      ...deudasDetalle,
    ]);

    const wsMetas = XLSX.utils.aoa_to_sheet([
      ["Metas programadas (snapshot)"],
      ["Mes", monthKey],
      [],
      ["Meta", "Objetivo", "Inicial", "Acumulado al mes", "Porcentaje", "Estado", "Mes origen"],
      ...metasUnicas.map((m) => {
        const acumulado = getMetaTotalHasta(m, monthKey);
        const objetivo = Number(m.objetivo || 0);
        const porcentaje = objetivo ? Math.min((acumulado / objetivo) * 100, 100) : 0;
        const estado = objetivo ? (porcentaje >= 100 ? "Completada" : "En progreso") : "Sin objetivo";
        return [m.nombre || "", objetivo, Number(m.inicial || 0), acumulado, porcentaje, estado, m._sourceMonth || ""];
      }),
    ]);

    wsResumen["!cols"] = [{ wch: 44 }, { wch: 26 }];
    wsDetalle["!cols"] = [
      { wch: 26 },
      { wch: 30 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 16 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
    ];
    wsMetas["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 16 }, { wch: 12 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsResumen, "Balance_Mes");
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle_Mes");
    XLSX.utils.book_append_sheet(wb, wsMetas, "Metas_Mes");

    downloadXlsx(wb, `informe-mensual-${monthKey}.xlsx`);
  }

  function exportarInformeGeneral() {
    const keys = Object.keys(data.months || {}).sort();
    const lastKey = keys.length ? keys[keys.length - 1] : monthKey;

    const metasUnicas = Array.from(new Map(metasGlobales.map((m) => [m.id, m])).values());

    const ahorroGeneralTotal = getAhorroGeneralHasta(lastKey, data.months);
    const metasTotal = metasUnicas.reduce((acc, m) => acc + getMetaTotalHasta(m, lastKey), 0);
    const gastosAcumuladosTotal = getGastosHasta(lastKey, data.months);

    const porCobrarPendienteTotal = keys.flatMap((k) =>
      ensureMonthShape(data.months[k]).porCobrar.map((item) => ({ ...item, _sourceMonth: k })),
    ).reduce((acc, item) => acc + getSaldoPendienteHasta(item, lastKey), 0);

    const deudasPendientesTotal = keys.flatMap((k) =>
      ensureMonthShape(data.months[k]).deudas.map((item) => ({ ...item, _sourceMonth: k })),
    ).reduce((acc, item) => acc + getSaldoPendienteHasta(item, lastKey), 0);

    const balanceGeneral = ahorroGeneralTotal + metasTotal + porCobrarPendienteTotal - deudasPendientesTotal - gastosAcumuladosTotal;

    // Evolución mensual: snapshot al final de cada mes
    const wsEvolucion = XLSX.utils.aoa_to_sheet([
      ["Evolución mensual (snapshot)"],
      ["Moneda", "COP (números)"],
      [],
      ["Mes", "Ahorro general acum.", "Metas acum.", "Gastos acum.", "Por cobrar pend.", "Deudas pend.", "Balance neto"],
      ...keys.map((k) => {
        const ahorroGen = getAhorroGeneralHasta(k, data.months);
        const metasAcum = metasUnicas.reduce((acc, m) => acc + getMetaTotalHasta(m, k), 0);
        const gastosAcum = getGastosHasta(k, data.months);
        const porCobrarPend = keys
          .filter((x) => x <= k)
          .flatMap((x) => ensureMonthShape(data.months[x]).porCobrar.map((item) => ({ ...item, _sourceMonth: x })))
          .reduce((acc, item) => acc + getSaldoPendienteHasta(item, k), 0);
        const deudasPend = keys
          .filter((x) => x <= k)
          .flatMap((x) => ensureMonthShape(data.months[x]).deudas.map((item) => ({ ...item, _sourceMonth: x })))
          .reduce((acc, item) => acc + getSaldoPendienteHasta(item, k), 0);
        const balance = ahorroGen + metasAcum + porCobrarPend - deudasPend - gastosAcum;
        return [k, ahorroGen, metasAcum, gastosAcum, porCobrarPend, deudasPend, balance];
      }),
    ]);

    // Metas al corte final
    const wsMetas = XLSX.utils.aoa_to_sheet([
      ["Metas programadas (al corte)"],
      ["Corte", lastKey],
      [],
      ["Meta", "Objetivo", "Inicial", "Acumulado", "Porcentaje", "Estado", "Mes origen"],
      ...metasUnicas.map((m) => {
        const acumulado = getMetaTotalHasta(m, lastKey);
        const objetivo = Number(m.objetivo || 0);
        const porcentaje = objetivo ? Math.min((acumulado / objetivo) * 100, 100) : 0;
        const estado = objetivo ? (porcentaje >= 100 ? "Completada" : "En progreso") : "Sin objetivo";
        return [m.nombre || "", objetivo, Number(m.inicial || 0), acumulado, porcentaje, estado, m._sourceMonth || ""];
      }),
    ]);

    // Detalle de pendientes al corte final
    const porCobrarPendientes = keys.flatMap((k) =>
      ensureMonthShape(data.months[k]).porCobrar.map((item) => ({ ...item, _sourceMonth: k })),
    )
    .map((item) => {
      const saldo = getSaldoPendienteHasta(item, lastKey);
      if (saldo <= 0) return null;
      const abonosHasta = (Array.isArray(item?.abonos) ? item.abonos : []).filter(
        (a) => a?.fecha && a.fecha.slice(0, 7) <= lastKey,
      );
      const ultimoAbono = abonosHasta.map((a) => a.fecha).sort().slice(-1)[0];
      return [
        item.persona || "",
        item.concepto || "",
        Number(item?.monto || 0),
        saldo,
        item.fechaCreacion || "",
        item.fechaCobro || "",
        item._sourceMonth || "",
        getDueStatus(item.fechaCobro),
        abonosHasta.length,
        ultimoAbono || "",
      ];
    })
    .filter(Boolean);

    const deudasPendientes = keys.flatMap((k) =>
      ensureMonthShape(data.months[k]).deudas.map((item) => ({ ...item, _sourceMonth: k })),
    )
    .map((item) => {
      const saldo = getSaldoPendienteHasta(item, lastKey);
      if (saldo <= 0) return null;
      const abonosHasta = (Array.isArray(item?.abonos) ? item.abonos : []).filter(
        (a) => a?.fecha && a.fecha.slice(0, 7) <= lastKey,
      );
      const ultimoAbono = abonosHasta.map((a) => a.fecha).sort().slice(-1)[0];
      return [
        item.persona || "",
        item.concepto || "",
        Number(item?.monto || 0),
        saldo,
        item.fechaCreacion || "",
        item.fechaPago || "",
        item._sourceMonth || "",
        getDueStatus(item.fechaPago),
        abonosHasta.length,
        ultimoAbono || "",
      ];
    })
    .filter(Boolean);

    const wsResumen = XLSX.utils.aoa_to_sheet([
      ["Informe general (snapshot al corte final)"],
      ["Corte", lastKey],
      [],
      ["Balance neto general (fórmula)"],
      ["Ahorro general acumulado", ahorroGeneralTotal],
      ["Ahorro en metas acumulado", metasTotal],
      ["Por cobrar pendiente (al corte)", porCobrarPendienteTotal],
      ["Deudas pendientes (al corte)", deudasPendientesTotal],
      ["Gastos acumulados", gastosAcumuladosTotal],
      ["Balance neto general (fórmula)", "Ahorro general + Metas + Por cobrar - Deudas - Gastos"],
      ["Balance neto general", balanceGeneral],
    ]);

    const wsDetalle = XLSX.utils.aoa_to_sheet([
      ["Por cobrar pendientes (al corte)"],
      ["Persona", "Concepto", "Monto total", "Saldo al corte", "Fecha realizada", "Fecha cobro", "Mes origen", "Alerta", "Abonos hasta corte", "Ultimo abono"],
      ...porCobrarPendientes,
      [],
      ["Deudas pendientes (al corte)"],
      ["Persona", "Concepto", "Monto total", "Saldo al corte", "Fecha realizada", "Fecha pago", "Mes origen", "Alerta", "Abonos hasta corte", "Ultimo abono"],
      ...deudasPendientes,
    ]);

    wsResumen["!cols"] = [{ wch: 48 }, { wch: 26 }];
    wsEvolucion["!cols"] = [
      { wch: 12 },
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 14 },
      { wch: 18 },
    ];
    wsMetas["!cols"] = [{ wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
    wsDetalle["!cols"] = [
      { wch: 26 },
      { wch: 24 },
      { wch: 14 },
      { wch: 16 },
      { wch: 16 },
      { wch: 16 },
      { wch: 12 },
      { wch: 10 },
      { wch: 18 },
      { wch: 18 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsResumen, "Balance_General");
    XLSX.utils.book_append_sheet(wb, wsEvolucion, "Evolucion_Mensual");
    XLSX.utils.book_append_sheet(wb, wsMetas, "Metas_General");
    XLSX.utils.book_append_sheet(wb, wsDetalle, "Detalle_Pendientes");

    downloadXlsx(wb, `informe-general.xlsx`);
  }

  const porCobrarFiltrado = useMemo(() => {
    return porCobrarArrastrado.filter((item) => {
      if (getSaldoPendiente(item) <= 0) return false;
      if (filtroCobrar === "todos") return true;
      const status = getDueStatus(item.fechaCobro);
      if (filtroCobrar === "hoy") return status === "hoy";
      if (filtroCobrar === "semana") return status === "semana";
      if (filtroCobrar === "vencido") return status === "vencido";
      return true;
    });
  }, [porCobrarArrastrado, filtroCobrar]);

  const deudasFiltradas = useMemo(() => {
    return deudasArrastradas.filter((item) => {
      if (getSaldoPendiente(item) <= 0) return false;
      if (filtroDeudas === "todos") return true;
      const status = getDueStatus(item.fechaPago);
      if (filtroDeudas === "hoy") return status === "hoy";
      if (filtroDeudas === "semana") return status === "semana";
      if (filtroDeudas === "vencido") return status === "vencido";
      return true;
    });
  }, [deudasArrastradas, filtroDeudas]);

  return (
    <main
      className={`min-h-screen p-4 md:p-8 ${
        isDark
          ? "bg-gradient-to-b from-slate-950 via-slate-900/40 to-slate-950"
          : "bg-white"
      }`}
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <header
          className={`relative overflow-hidden rounded-3xl border p-6 shadow-xl ${
            headerIsDark
              ? "border-indigo-100 bg-gradient-to-r from-slate-900 via-indigo-900 to-slate-900 text-white"
              : "border-indigo-200 bg-white text-slate-900"
          }`}
        >
          <h1 className="text-2xl font-bold md:text-3xl">Sistema de ahorro</h1>
          <p
            className={`mt-2 max-w-2xl text-sm ${
              headerIsDark ? "text-indigo-100" : "text-indigo-700"
            }`}
          >
            Realiza tus ahorros, cobros y deudas.
          </p>
          <p
            className={`mt-3 inline-block rounded-lg px-3 py-1 text-xs ${
              online
                ? headerIsDark
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-emerald-100 text-emerald-800"
                : headerIsDark
                  ? "bg-amber-500/20 text-amber-200"
                  : "bg-amber-100 text-amber-800"
            }`}
          >
            {online ? "En linea" : "Sin conexion - datos locales activos"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={exportarRespaldo}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                headerIsDark
                  ? "bg-white/20 text-white hover:bg-white/30"
                  : "bg-slate-100 text-slate-800 hover:bg-slate-200"
              }`}
            >
              Exportar respaldo JSON
            </button>
            <button
              onClick={exportarInformeMensual}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                headerIsDark
                  ? "bg-white/20 text-white hover:bg-white/30"
                  : "bg-slate-100 text-slate-800 hover:bg-slate-200"
              }`}
            >
              Excel informe mensual
            </button>
            <button
              onClick={exportarInformeGeneral}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                headerIsDark
                  ? "bg-white/20 text-white hover:bg-white/30"
                  : "bg-slate-100 text-slate-800 hover:bg-slate-200"
              }`}
            >
              Excel informe general
            </button>
            <label
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                headerIsDark
                  ? "bg-white/20 text-white hover:bg-white/30"
                  : "bg-slate-100 text-slate-800 hover:bg-slate-200"
              }`}
            >
              Importar respaldo JSON
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={importarRespaldo}
              />
            </label>
          </div>

          <button
            type="button"
            aria-label={themeMode === "dark" ? "Cambiar a Claro" : "Cambiar a Oscuro"}
            onClick={() => setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))}
            className={`absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border transition focus:outline-none focus:ring-2 ${
              headerIsDark
                ? "border-white/20 bg-white/10 text-white hover:bg-white/20 focus:ring-white/30"
                : "border-slate-200 bg-slate-100 text-slate-800 hover:bg-slate-200 focus:ring-slate-300"
            }`}
          >
            {themeMode === "dark" ? (
              // Sol (modo oscuro -> cambiar a claro)
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2" />
                <path d="M12 21v2" />
                <path d="M4.22 4.22l1.42 1.42" />
                <path d="M18.36 18.36l1.42 1.42" />
                <path d="M1 12h2" />
                <path d="M21 12h2" />
                <path d="M4.22 19.78l1.42-1.42" />
                <path d="M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              // Luna (modo claro -> cambiar a oscuro)
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
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
                tab === key
                  ? isDark
                    ? "bg-slate-900 text-white shadow-md"
                    : "bg-indigo-600 text-white shadow-md"
                  : isDark
                    ? "text-slate-200 hover:bg-slate-800"
                    : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "ahorro" && (
          <section className="grid gap-4 lg:grid-cols-2">
            <article className={cardClass}>
              <h2
                className={`mb-3 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Ahorro general (aparte de metas)
              </h2>
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
              <h2
                className={`mb-3 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Crear ahorro programado
              </h2>
              <form className="space-y-3" onSubmit={crearMeta}>
                <input className={inputClass} placeholder="Nombre meta (ej. Moto)" value={metaNombre} onChange={(e) => setMetaNombre(e.target.value)} />
                <textarea className={inputClass} rows={2} placeholder="Descripcion" value={metaDescripcion} onChange={(e) => setMetaDescripcion(e.target.value)} />
                <div className="grid gap-3 md:grid-cols-2">
                  <input className={inputClass} type="number" min="0" placeholder="Objetivo" value={metaObjetivo} onChange={(e) => setMetaObjetivo(e.target.value)} />
                  <input className={inputClass} type="number" min="0" placeholder="Inicial (opcional)" value={metaInicial} onChange={(e) => setMetaInicial(e.target.value)} />
                </div>
                <input className={inputClass} type="date" value={metaFechaObjetivo} onChange={(e) => setMetaFechaObjetivo(e.target.value)} />
                <button className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500">
                  Guardar meta
                </button>
              </form>
            </article>

            <article className={`${cardClass} lg:col-span-2`}>
              <h2
                className={`mb-3 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Metas programadas
              </h2>
              <div className="space-y-3">
                {metasGlobales.length === 0 && <p className="text-sm text-slate-500">No has creado metas programadas.</p>}
                {metasGlobales.map((meta) => {
                  const totalMeta = getMetaTotal(meta);
                  const porcentaje = meta.objetivo ? Math.min((totalMeta / Number(meta.objetivo)) * 100, 100) : 0;
                  const completada = porcentaje >= 100;
                  return (
                    <div
                      key={meta.id}
                      className={`rounded-xl border p-4 ${
                        isDark
                          ? "border-slate-700 bg-slate-900/60"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className={`font-semibold ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                            {meta.nombre}
                          </p>
                          <p className="text-xs text-slate-500">{meta.descripcion || "Sin descripcion"}</p>
                        </div>
                        <button
                          onClick={() => eliminarMeta(meta.id)}
                          className={`rounded-lg px-3 py-1 text-xs font-medium ${
                            isDark
                              ? "bg-rose-900/40 text-rose-200 hover:bg-rose-900/60"
                              : "bg-rose-100 text-rose-700 hover:bg-rose-200"
                          }`}
                        >
                          Borrar meta
                        </button>
                      </div>
                      <p className={`mt-2 text-sm ${isDark ? "text-slate-200" : "text-slate-600"}`}>
                        {formatMoney(totalMeta)} de {formatMoney(meta.objetivo)} {meta.fechaObjetivo ? `- Fecha objetivo: ${meta.fechaObjetivo}` : ""}
                      </p>
                      <p className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                        Mes origen: {meta._sourceMonth}
                      </p>
                      <div
                        className={`mt-2 h-2 w-full overflow-hidden rounded-full ${
                          isDark ? "bg-slate-800" : "bg-slate-200"
                        }`}
                      >
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
              <h2
                className={`mb-4 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Agregar por cobrar
              </h2>
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
              <h2
                className={`mb-3 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Listado por cobrar
              </h2>
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
                  const dueStatus = getDueStatus(item.fechaCobro);
                  const statusClass =
                    dueStatus === "vencido"
                      ? isDark
                        ? "bg-rose-900/40 text-rose-200"
                        : "bg-rose-100 text-rose-700"
                      : dueStatus === "hoy"
                        ? isDark
                          ? "bg-amber-900/40 text-amber-200"
                          : "bg-amber-100 text-amber-700"
                        : dueStatus === "semana"
                          ? isDark
                            ? "bg-blue-900/40 text-blue-200"
                            : "bg-blue-100 text-blue-700"
                          : isDark
                            ? "bg-slate-800 text-slate-200"
                            : "bg-slate-100 text-slate-600";
                  const statusLabel =
                    dueStatus === "vencido"
                        ? "Vencido"
                        : dueStatus === "hoy"
                          ? "Vence hoy"
                          : dueStatus === "semana"
                            ? "Vence esta semana"
                            : "Sin alerta";
                  const saldoPendiente = getSaldoPendiente(item);
                  return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3 ${
                      isDark
                        ? "bg-slate-900/60 border-slate-700"
                        : "bg-white border-slate-200"
                    } ${
                      dueStatus === "vencido"
                        ? isDark
                          ? "border-rose-700/60"
                          : "border-rose-300"
                        : ""
                    }`}
                  >
                    <p className={`font-medium ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                      {item.persona}
                    </p>
                    <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                      {item.concepto || "Sin concepto"}
                    </p>
                    <p
                      className={`text-sm font-semibold ${
                        isDark ? "text-blue-300" : "text-blue-700"
                      }`}
                    >
                      {formatMoney(item.monto)}
                    </p>
                    <p className={`text-xs ${isDark ? "text-slate-300" : "text-slate-500"}`}>
                      Saldo pendiente: {formatMoney(saldoPendiente)}
                    </p>
                    <p className={`text-xs ${isDark ? "text-slate-300" : "text-slate-500"}`}>
                      Mes origen: {item._sourceMonth} | Realizada: {item.fechaCreacion || "No definida"} | Cobro: {item.fechaCobro || "No definida"}
                    </p>
                    <span className={`mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium ${statusClass}`}>
                      {statusLabel}
                    </span>
                    <div className="mt-2 space-y-2">
                      <div className="flex gap-2">
                        <input
                          className={inputClass}
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Abono"
                          value={abonoPorCobrar[item.id] || ""}
                          onChange={(e) => setAbonoPorCobrar((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        />
                        <button
                          onClick={() => abonarPorCobrar(item.id)}
                          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
                        >
                          Abonar
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleEstado("porCobrar", item.id)}
                          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                        >
                          Pago completo
                        </button>
                      <button
                        onClick={() => eliminarRegistro("porCobrar", item.id)}
                        className={`rounded-xl px-3 py-1.5 text-sm font-medium hover:bg-rose-200 ${
                          isDark
                            ? "bg-rose-900/40 text-rose-200 hover:bg-rose-900/60"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                          Borrar
                        </button>
                      </div>
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
              <h2
                className={`mb-4 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Agregar deuda
              </h2>
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
              <h2
                className={`mb-3 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Listado de deudas
              </h2>
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
                  const dueStatus = getDueStatus(item.fechaPago);
                  const statusClass =
                    dueStatus === "vencido"
                      ? isDark
                        ? "bg-rose-900/40 text-rose-200"
                        : "bg-rose-100 text-rose-700"
                      : dueStatus === "hoy"
                        ? isDark
                          ? "bg-amber-900/40 text-amber-200"
                          : "bg-amber-100 text-amber-700"
                        : dueStatus === "semana"
                          ? isDark
                            ? "bg-blue-900/40 text-blue-200"
                            : "bg-blue-100 text-blue-700"
                          : isDark
                            ? "bg-slate-800 text-slate-200"
                            : "bg-slate-100 text-slate-600";
                  const statusLabel =
                    dueStatus === "vencido"
                        ? "Vencida"
                        : dueStatus === "hoy"
                          ? "Vence hoy"
                          : dueStatus === "semana"
                            ? "Vence esta semana"
                            : "Sin alerta";
                  const saldoPendiente = getSaldoPendiente(item);
                  return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3 ${
                      isDark
                        ? "bg-slate-900/60 border-slate-700"
                        : "bg-white border-slate-200"
                    } ${
                      dueStatus === "vencido"
                        ? isDark
                          ? "border-rose-700/60"
                          : "border-rose-300"
                        : ""
                    }`}
                  >
                    <p className={`font-medium ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                      {item.persona}
                    </p>
                    <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                      {item.concepto || "Sin concepto"}
                    </p>
                    <p
                      className={`text-sm font-semibold ${
                        isDark ? "text-rose-200" : "text-rose-700"
                      }`}
                    >
                      {formatMoney(item.monto)}
                    </p>
                    <p className={`text-xs ${isDark ? "text-slate-300" : "text-slate-500"}`}>
                      Saldo pendiente: {formatMoney(saldoPendiente)}
                    </p>
                    <p className={`text-xs ${isDark ? "text-slate-300" : "text-slate-500"}`}>
                      Mes origen: {item._sourceMonth} | Realizada: {item.fechaCreacion || "No definida"} | Pago: {item.fechaPago || "No definida"}
                    </p>
                    <span className={`mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium ${statusClass}`}>
                      {statusLabel}
                    </span>
                    <div className="mt-2 space-y-2">
                      <div className="flex gap-2">
                        <input
                          className={inputClass}
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Abono"
                          value={abonoDeudas[item.id] || ""}
                          onChange={(e) => setAbonoDeudas((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        />
                        <button
                          onClick={() => abonarDeudas(item.id)}
                          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
                        >
                          Abonar
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => toggleEstado("deudas", item.id)}
                          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
                        >
                          Pago completo
                        </button>
                      <button
                        onClick={() => eliminarRegistro("deudas", item.id)}
                        className={`rounded-xl px-3 py-1.5 text-sm font-medium hover:bg-rose-200 ${
                          isDark
                            ? "bg-rose-900/40 text-rose-200 hover:bg-rose-900/60"
                            : "bg-rose-100 text-rose-700"
                        }`}
                      >
                          Borrar
                        </button>
                      </div>
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
              <h2
                className={`mb-4 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Registrar gasto del mes
              </h2>
              <form className="space-y-3" onSubmit={agregarGasto}>
                <input className={inputClass} placeholder="Concepto" value={gastoConcepto} onChange={(e) => setGastoConcepto(e.target.value)} />
                <input className={inputClass} placeholder="Categoria (ej. Transporte)" value={gastoCategoria} onChange={(e) => setGastoCategoria(e.target.value)} />
                <input className={inputClass} type="number" min="0" placeholder="Monto" value={gastoMonto} onChange={(e) => setGastoMonto(e.target.value)} />
                <input className={inputClass} type="date" value={gastoFecha} onChange={(e) => setGastoFecha(e.target.value)} />
                <button className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-500">Agregar gasto</button>
              </form>
            </article>
            <article className={cardClass}>
              <h2
                className={`mb-3 text-lg font-semibold ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                Listado de gastos
              </h2>
              <div className="space-y-2">
                {monthData.gastos.length === 0 && <p className="text-sm text-slate-500">No hay gastos en este mes.</p>}
                {monthData.gastos.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3 ${
                      isDark ? "bg-slate-900/60 border-slate-700" : "bg-white border-slate-200"
                    }`}
                  >
                    <p className={`font-medium ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                      {item.concepto}
                    </p>
                    <p className={`text-sm ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                      {item.categoria || "Sin categoria"}
                    </p>
                    <p className={`text-sm font-semibold ${isDark ? "text-amber-200" : "text-amber-700"}`}>
                      {formatMoney(item.monto)}
                    </p>
                    <p className={`text-xs ${isDark ? "text-slate-300" : "text-slate-500"}`}>
                      Fecha: {item.fecha || "No definida"}
                    </p>
                    <button
                      onClick={() => eliminarRegistro("gastos", item.id)}
                      className={`mt-2 rounded-xl px-3 py-1.5 text-sm font-medium hover:bg-rose-200 ${
                        isDark
                          ? "bg-rose-900/40 text-rose-200 hover:bg-rose-900/60"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      Borrar
                    </button>
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
