const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit-table');

const SUPABASE_URL = 'https://pnaobmyaugbccfwwhyob.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuYW9ibXlhdWdiY2Nmd3doeW9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzMzQwMzcsImV4cCI6MjA4MzkxMDAzN30.-TwJWOKZWXNDq2u789-dRcX--yA4fWjGSgHc-Zr-ny4';

const ZONAS_CRITICAS = [
    { nombre: 'Sector Hospital San Juan', lat: -1.662198, lng: -78.658870, radioMetros: 300 },
    { nombre: 'Sector Redondel del Comil', lat: -1.665350, lng: -78.649496, radioMetros: 300 },
    { nombre: 'Sector Prefectura de Chimborazo', lat: -1.668763, lng: -78.652333, radioMetros: 300 },
    { nombre: 'Sector Plaza Alfaro', lat: -1.671071, lng: -78.654227, radioMetros: 300 },
    { nombre: 'Sector Mercado San Alfonso', lat: -1.671138, lng: -78.647331, radioMetros: 300 }
];

function haversineMetros(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = deg => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcDescriptiveStats(values) {
    if (!values || values.length === 0) return { mean: 0, median: 0, stdDev: 0, variance: 0, cv: 0, min: 0, max: 0, q1: 0, q3: 0, iqr: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const variance = sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? (stdDev / mean) * 100 : 0;

    const quantile = (q) => {
        const pos = (n - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        if (sorted[base + 1] !== undefined) {
            return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        }
        return sorted[base];
    };

    const median = quantile(0.5);
    const q1 = quantile(0.25);
    const q3 = quantile(0.75);
    const iqr = q3 - q1;

    return {
        mean: Number(mean.toFixed(2)),
        median: Number(median.toFixed(2)),
        stdDev: Number(stdDev.toFixed(2)),
        variance: Number(variance.toFixed(2)),
        cv: Number(cv.toFixed(2)),
        min: sorted[0],
        max: sorted[n - 1],
        q1: Number(q1.toFixed(2)),
        q3: Number(q3.toFixed(2)),
        iqr: Number(iqr.toFixed(2))
    };
}

function calcPearson(x, y) {
    const n = x.length;
    if (n === 0 || n !== y.length) return 0;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : Number((num / den).toFixed(4));
}

async function fetchTable(tableName) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=*`, {
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) throw new Error(`Error al consultar ${tableName}: ${res.statusText}`);
    return await res.json();
}

async function main() {
    console.log('Consultando datos actualizados desde Supabase...');
    const reportesRaw = await fetchTable('reportes');
    const perimetroRaw = await fetchTable('perimetro_urbano');

    console.log(`Registros cargados desde Supabase: ${reportesRaw.length}`);

    const diasSemana = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const mesesNombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

    const data = reportesRaw.map(r => {
        const fallecidos = (r.Fallecidos === 'NULL' || r.Fallecidos == null) ? 0 : (parseInt(r.Fallecidos, 10) || 0);
        const heridos = (r.Heridos === 'NULL' || r.Heridos == null) ? 0 : (parseInt(r.Heridos, 10) || 0);
        const horaStr = r.hora ? r.hora.toString().split('.')[0] : "12:00:00";
        const partsHora = horaStr.split(':').map(Number);
        const horaNum = (!isNaN(partsHora[0]) && partsHora[0] >= 0 && partsHora[0] <= 23) ? partsHora[0] : 12;

        let franja = "Tarde";
        if (horaNum >= 0 && horaNum < 6) franja = "Madrugada";
        else if (horaNum >= 6 && horaNum < 12) franja = "Mañana";
        else if (horaNum >= 12 && horaNum < 18) franja = "Tarde";
        else franja = "Noche";

        let fecha = r.date;
        if (!fecha && r.fecha_reporte) {
            fecha = r.fecha_reporte.toString().slice(0, 10);
        }
        if (!fecha) fecha = "2026-01-01";

        const dateObj = new Date(fecha + "T00:00:00");
        const diaSemana = !isNaN(dateObj.getDay()) ? diasSemana[dateObj.getDay()] : "Lunes";
        const mesIdx = !isNaN(dateObj.getMonth()) ? dateObj.getMonth() : 0;
        const mes = mesesNombres[mesIdx] || "Enero";
        const anioMes = fecha.slice(0, 7);

        let severidad = "Solo Daños Materiales";
        if (fallecidos > 0) severidad = "Con Fallecidos";
        else if (heridos > 0) severidad = "Con Heridos";

        let lat = parseFloat(r.latitud);
        let lng = parseFloat(r.longitud);
        if ((isNaN(lat) || isNaN(lng)) && r.geom && r.geom.coordinates) {
            lng = parseFloat(r.geom.coordinates[0]);
            lat = parseFloat(r.geom.coordinates[1]);
        }
        if (isNaN(lat)) lat = -1.666;
        if (isNaN(lng)) lng = -78.655;

        const desc = (r.descripcion || "").toLowerCase();
        const inv_moto = desc.includes('moto') || desc.includes('motocicl');
        const inv_taxi = desc.includes('taxy') || desc.includes('taxi');
        const inv_bus = desc.includes('bus') || desc.includes('colectivo');
        const inv_peaton = desc.includes('peaton') || desc.includes('peatón') || desc.includes('atropell') || desc.includes('ciclist');
        const inv_alcohol = desc.includes('ebrio') || desc.includes('etílico') || desc.includes('alcohol') || desc.includes('licor') || desc.includes('embriag');
        const inv_camioneta = desc.includes('camioneta') || desc.includes('camión') || desc.includes('camion') || desc.includes('furgoneta');
        const inv_volcamiento = desc.includes('volca') || desc.includes('pérdida de pista') || desc.includes('perdida de pista') || desc.includes('estrell');

        // Zona crítica más cercana
        let zonaCercana = "Resto del Perímetro Urbano";
        let minDist = Infinity;
        ZONAS_CRITICAS.forEach(z => {
            const d = haversineMetros(lat, lng, z.lat, z.lng);
            if (d <= z.radioMetros && d < minDist) {
                minDist = d;
                zonaCercana = z.nombre;
            }
        });

        return {
            id: r.id,
            lat,
            lng,
            tipo_reporte: r.tipo_reporte || "Colisión Vehicular",
            descripcion: (r.descripcion || "Sin descripción").trim(),
            hora: horaStr,
            horaNum,
            franja,
            fecha,
            anioMes,
            diaSemana,
            mes,
            mesIdx,
            fallecidos,
            heridos,
            severidad,
            zonaCercana,
            factores: {
                moto: inv_moto,
                taxi: inv_taxi,
                bus: inv_bus,
                peaton: inv_peaton,
                alcohol: inv_alcohol,
                camioneta: inv_camioneta,
                volcamiento: inv_volcamiento
            }
        };
    }).sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));

    const totalSiniestros = data.length;
    const totalFallecidos = data.reduce((sum, r) => sum + r.fallecidos, 0);
    const totalHeridos = data.reduce((sum, r) => sum + r.heridos, 0);

    const conFallecidos = data.filter(r => r.fallecidos > 0).length;
    const conHeridos = data.filter(r => r.fallecidos === 0 && r.heridos > 0).length;
    const soloDanos = data.filter(r => r.fallecidos === 0 && r.heridos === 0).length;

    const porHora = Array.from({ length: 24 }, (_, i) => ({ hora: i, siniestros: 0, fallecidos: 0, heridos: 0 }));
    data.forEach(r => {
        if (porHora[r.horaNum]) {
            porHora[r.horaNum].siniestros++;
            porHora[r.horaNum].fallecidos += r.fallecidos;
            porHora[r.horaNum].heridos += r.heridos;
        }
    });

    const franjasOrden = ["Madrugada", "Mañana", "Tarde", "Noche"];
    const porFranja = {};
    franjasOrden.forEach(f => porFranja[f] = { siniestros: 0, fallecidos: 0, heridos: 0, danos: 0, conHeridos: 0, conFallecidos: 0 });
    data.forEach(r => {
        porFranja[r.franja].siniestros++;
        porFranja[r.franja].fallecidos += r.fallecidos;
        porFranja[r.franja].heridos += r.heridos;
        if (r.fallecidos > 0) porFranja[r.franja].conFallecidos++;
        else if (r.heridos > 0) porFranja[r.franja].conHeridos++;
        else porFranja[r.franja].danos++;
    });

    const diasOrden = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
    const porDia = {};
    diasOrden.forEach(d => porDia[d] = { siniestros: 0, fallecidos: 0, heridos: 0 });
    data.forEach(r => {
        if (porDia[r.diaSemana]) {
            porDia[r.diaSemana].siniestros++;
            porDia[r.diaSemana].fallecidos += r.fallecidos;
            porDia[r.diaSemana].heridos += r.heridos;
        }
    });

    const porMes = {};
    mesesNombres.forEach((m, idx) => {
        const count = data.filter(r => r.mesIdx === idx);
        if (count.length > 0) {
            porMes[m] = {
                mesIdx: idx,
                siniestros: count.length,
                fallecidos: count.reduce((acc, x) => acc + x.fallecidos, 0),
                heridos: count.reduce((acc, x) => acc + x.heridos, 0)
            };
        }
    });

    const factoresCount = {
        Motos: data.filter(r => r.factores.moto).length,
        Taxis: data.filter(r => r.factores.taxi).length,
        Camionetas_Carga: data.filter(r => r.factores.camioneta).length,
        Volcamientos_ChoquesFijos: data.filter(r => r.factores.volcamiento).length,
        Peatones_Ciclistas: data.filter(r => r.factores.peaton).length,
        Buses: data.filter(r => r.factores.bus).length,
        Alcohol_Ebriedad: data.filter(r => r.factores.alcohol).length
    };

    // Estadísticas descriptivas avanzadas
    const conteoPorFecha = {};
    data.forEach(r => { conteoPorFecha[r.fecha] = (conteoPorFecha[r.fecha] || 0) + 1; });
    const valoresDiarios = Object.values(conteoPorFecha);
    const valoresMensuales = Object.values(porMes).map(m => m.siniestros);
    const valoresHorarios = porHora.map(h => h.siniestros);
    const victimasHorarias = porHora.map(h => h.heridos + h.fallecidos);

    const statsDiarios = calcDescriptiveStats(valoresDiarios);
    const statsMensuales = calcDescriptiveStats(valoresMensuales);
    const statsHorarios = calcDescriptiveStats(valoresHorarios);
    const correlacionHoraVictimas = calcPearson(valoresHorarios, victimasHorarias);

    // Índice de Severidad Ponderado (ISP): (1*Daños + 3*ConHeridos + 10*ConFallecidos) / Total
    const isp = totalSiniestros > 0 ? Number(((1 * soloDanos + 3 * conHeridos + 10 * conFallecidos) / totalSiniestros).toFixed(2)) : 0;

    let horaPicoSiniestros = porHora.reduce((max, h) => h.siniestros > max.siniestros ? h : max, porHora[0]);
    let horaPicoVictimas = porHora.reduce((max, h) => (h.heridos + h.fallecidos) > (max.heridos + max.fallecidos) ? h : max, porHora[0]);
    let franjaMax = Object.keys(porFranja).reduce((a, b) => porFranja[a].siniestros > porFranja[b].siniestros ? a : b);
    let diaMax = Object.keys(porDia).reduce((a, b) => porDia[a].siniestros > porDia[b].siniestros ? a : b);
    let mesMax = Object.keys(porMes).reduce((a, b) => porMes[a].siniestros > porMes[b].siniestros ? a : b);

    const stats = {
        ultimaActualizacion: new Date().toISOString().slice(0, 10),
        totalSiniestros,
        totalFallecidos,
        totalHeridos,
        conFallecidos,
        conHeridos,
        soloDanos,
        tasaHeridos: (totalHeridos / (totalSiniestros || 1)).toFixed(2),
        tasaFallecidos: (totalFallecidos / (totalSiniestros || 1)).toFixed(3),
        indiceMorbilidad100: ((totalHeridos / (totalSiniestros || 1)) * 100).toFixed(1),
        indiceLetalidad100: ((totalFallecidos / (totalSiniestros || 1)) * 100).toFixed(2),
        probabilidadVictima: (((conHeridos + conFallecidos) / (totalSiniestros || 1)) * 100).toFixed(1),
        indiceSeveridadPonderado: isp,
        correlacionHoraVictimas,
        statsDiarios,
        statsMensuales,
        statsHorarios,
        diasConRegistro: valoresDiarios.length,
        porHora,
        porFranja,
        porDia,
        porMes,
        factoresCount,
        horaPicoSiniestros,
        horaPicoVictimas,
        franjaMax,
        diaMax,
        mesMax
    };

    const perimetroGeoms = (perimetroRaw || []).map(p => (typeof p.geom === 'string' ? JSON.parse(p.geom) : p.geom)).filter(Boolean);

    const outJsPath = path.join(__dirname, 'datos_reportes.js');
    const jsContent = `// Datos actualizados desde Supabase para el Geoportal Analítico de Siniestros Viales\n` +
        `const DATOS_STATS = ${JSON.stringify(stats, null, 2)};\n` +
        `const DATOS_REPORTES = ${JSON.stringify(data, null, 2)};\n` +
        `const DATOS_PERIMETRO = ${JSON.stringify(perimetroGeoms)};\n` +
        `const ZONAS_CRITICAS_REF = ${JSON.stringify(ZONAS_CRITICAS, null, 2)};\n`;

    fs.writeFileSync(outJsPath, jsContent, 'utf8');
    console.log("Archivo datos_reportes.js actualizado correctamente en:", outJsPath);

    // Generar PDF Oficial con tipografía Times-Roman
    const pdfPath = path.join(__dirname, 'reporte_estadistico_accidentes.pdf');
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
    doc.pipe(fs.createWriteStream(pdfPath));

    const cPrimary = '#0F172A';
    const cAccent = '#1D4ED8';
    const cDanger = '#B91C1C';
    const cWarn = '#B45309';
    const cText = '#1E293B';

    function drawHeader(title, subtitle) {
        doc.rect(0, 0, doc.page.width, 88).fill(cPrimary);
        doc.fillColor('#FFFFFF').fontSize(18).font('Times-Bold').text(title, 40, 24);
        doc.fillColor('#CBD5E1').fontSize(10.5).font('Times-Roman').text(subtitle, 40, 50);

        doc.roundedRect(doc.page.width - 175, 22, 135, 42, 4).fill('#1E293B');
        doc.fillColor('#93C5FD').fontSize(10).font('Times-Bold').text("GEOPORTAL ANALÍTICO", doc.page.width - 165, 29);
        doc.fillColor('#F1F5F9').fontSize(9).font('Times-Roman').text(`Actualizado: ${stats.ultimaActualizacion}`, doc.page.width - 165, 45);
        doc.moveDown(3);
    }

    drawHeader("INFORME ESTADÍSTICO DE SINIESTRALIDAD VIAL", "Análisis Descriptivo, Temporal, Espacial e Indicadores de Severidad (Riobamba)");
    doc.y = 105;

    doc.fillColor(cPrimary).fontSize(13).font('Times-Bold').text("1. Resumen Ejecutivo e Indicadores Clave de Desempeño (KPIs)", 40, doc.y);
    doc.moveDown(0.5);

    const startY = doc.y;
    const cardWidth = (doc.page.width - 80 - 30) / 4;
    const kpis = [
        { title: "SINIESTROS TOTALES", val: `${totalSiniestros}`, sub: `${stats.diasConRegistro} días con registro`, color: cAccent },
        { title: "TOTAL HERIDOS", val: `${totalHeridos}`, sub: `${stats.indiceMorbilidad100} por cada 100 sin.`, color: cWarn },
        { title: "TOTAL FALLECIDOS", val: `${totalFallecidos}`, sub: `${stats.indiceLetalidad100} por cada 100 sin.`, color: cDanger },
        { title: "HORA PICO CRÍTICA", val: `${String(horaPicoSiniestros.hora).padStart(2, '0')}:00`, sub: `${horaPicoSiniestros.siniestros} siniestros acumulados`, color: '#4338CA' }
    ];

    kpis.forEach((kpi, index) => {
        const x = 40 + index * (cardWidth + 10);
        doc.roundedRect(x, startY, cardWidth, 62, 4).fill('#F1F5F9');
        doc.rect(x, startY, cardWidth, 4).fill(kpi.color);
        doc.fillColor(cText).fontSize(8).font('Times-Bold').text(kpi.title, x + 8, startY + 11);
        doc.fillColor(kpi.color).fontSize(17).font('Times-Bold').text(kpi.val, x + 8, startY + 24);
        doc.fillColor('#475569').fontSize(8).font('Times-Roman').text(kpi.sub, x + 8, startY + 45);
    });

    doc.y = startY + 76;

    doc.fillColor(cPrimary).fontSize(13).font('Times-Bold').text("2. Métricas Estadísticas Avanzadas", 40, doc.y);
    doc.moveDown(0.3);
    doc.fillColor(cText).fontSize(10).font('Times-Roman').text(
        `El procesamiento estadístico sobre N = ${totalSiniestros} registros arroja una media mensual de ${statsMensuales.mean} siniestros/mes ` +
        `(mediana = ${statsMensuales.median}, desviación estándar = ${statsMensuales.stdDev}, coeficiente de variación = ${statsMensuales.cv}%). ` +
        `La media en días con incidentes es de ${statsDiarios.mean} siniestros/día (rango intercuartílico IQR = ${statsDiarios.iqr}). ` +
        `El Índice de Severidad Ponderado (ISP) global se sitúa en ${stats.indiceSeveridadPonderado}, mientras que la correlación lineal de Pearson entre ` +
        `la frecuencia horaria de siniestros y el volumen de víctimas es r = ${stats.correlacionHoraVictimas}.`,
        { align: 'justify', width: doc.page.width - 80 }
    );
    doc.moveDown(0.6);

    doc.fillColor(cPrimary).fontSize(13).font('Times-Bold').text("3. Distribución por Franjas Horarias", 40, doc.y);
    doc.moveDown(0.4);

    const tableFranjas = {
        headers: [
            { label: "Franja Horaria", property: "franja", width: 110 },
            { label: "Horario", property: "rango", width: 85 },
            { label: "N° Siniestros", property: "sins", width: 75, align: "right" },
            { label: "% Siniestros", property: "porc", width: 75, align: "right" },
            { label: "Heridos", property: "heridos", width: 75, align: "right" },
            { label: "Fallecidos", property: "fallecidos", width: 75, align: "right" }
        ],
        datas: [
            { franja: "Madrugada", rango: "00:00 - 05:59", sins: `${porFranja["Madrugada"].siniestros}`, porc: `${((porFranja["Madrugada"].siniestros / totalSiniestros) * 100).toFixed(1)}%`, heridos: `${porFranja["Madrugada"].heridos}`, fallecidos: `${porFranja["Madrugada"].fallecidos}` },
            { franja: "Mañana", rango: "06:00 - 11:59", sins: `${porFranja["Mañana"].siniestros}`, porc: `${((porFranja["Mañana"].siniestros / totalSiniestros) * 100).toFixed(1)}%`, heridos: `${porFranja["Mañana"].heridos}`, fallecidos: `${porFranja["Mañana"].fallecidos}` },
            { franja: "Tarde", rango: "12:00 - 17:59", sins: `${porFranja["Tarde"].siniestros}`, porc: `${((porFranja["Tarde"].siniestros / totalSiniestros) * 100).toFixed(1)}%`, heridos: `${porFranja["Tarde"].heridos}`, fallecidos: `${porFranja["Tarde"].fallecidos}` },
            { franja: "Noche", rango: "18:00 - 23:59", sins: `${porFranja["Noche"].siniestros}`, porc: `${((porFranja["Noche"].siniestros / totalSiniestros) * 100).toFixed(1)}%`, heridos: `${porFranja["Noche"].heridos}`, fallecidos: `${porFranja["Noche"].fallecidos}` },
            { franja: "TOTAL", rango: "00:00 - 23:59", sins: `${totalSiniestros}`, porc: "100.0%", heridos: `${totalHeridos}`, fallecidos: `${totalFallecidos}` }
        ]
    };

    await doc.table(tableFranjas, {
        prepareHeader: () => doc.font("Times-Bold").fontSize(9.5).fillColor("#0F172A"),
        prepareRow: (row, indexColumn, indexRow, rectRow) => {
            doc.font(row.franja === "TOTAL" ? "Times-Bold" : "Times-Roman").fontSize(9.5).fillColor("#1E293B");
            if (row.franja === "TOTAL") doc.addBackground(rectRow, "#E2E8F0", 1);
            else if (indexRow % 2 !== 0) doc.addBackground(rectRow, "#F8FAFC", 1);
        },
        padding: 5
    });

    doc.moveDown(0.6);
    doc.fillColor(cPrimary).fontSize(13).font('Times-Bold').text("4. Incidencia por Día de la Semana", 40, doc.y);
    doc.moveDown(0.4);

    const tableDias = {
        headers: [
            { label: "Día de la Semana", property: "dia", width: 130 },
            { label: "Siniestros", property: "sins", width: 90, align: "right" },
            { label: "% del Total", property: "porc", width: 90, align: "right" },
            { label: "Heridos", property: "heridos", width: 90, align: "right" },
            { label: "Fallecidos", property: "fallecidos", width: 95, align: "right" }
        ],
        datas: diasOrden.map(d => ({
            dia: d,
            sins: `${porDia[d].siniestros}`,
            porc: `${((porDia[d].siniestros / totalSiniestros) * 100).toFixed(1)}%`,
            heridos: `${porDia[d].heridos}`,
            fallecidos: `${porDia[d].fallecidos}`
        }))
    };

    await doc.table(tableDias, {
        prepareHeader: () => doc.font("Times-Bold").fontSize(9.5).fillColor("#0F172A"),
        prepareRow: (row, idx, indexRow, rectRow) => {
            doc.font("Times-Roman").fontSize(9.5).fillColor("#1E293B");
            if (indexRow % 2 !== 0) doc.addBackground(rectRow, "#F8FAFC", 1);
        },
        padding: 5
    });

    doc.addPage();
    drawHeader("EVOLUCIÓN MENSUAL Y FACTORES DE RIESGO", "Desglose Temporal 2026 y Tipología de Actores Involucrados");
    doc.y = 105;

    doc.fillColor(cPrimary).fontSize(13).font('Times-Bold').text("5. Evolución Mensual de Siniestros (Período 2026)", 40, doc.y);
    doc.moveDown(0.4);

    const tableMeses = {
        headers: [
            { label: "Mes", property: "mes", width: 130 },
            { label: "Siniestros", property: "sins", width: 90, align: "right" },
            { label: "% del Total", property: "porc", width: 90, align: "right" },
            { label: "Heridos", property: "heridos", width: 90, align: "right" },
            { label: "Fallecidos", property: "fallecidos", width: 95, align: "right" }
        ],
        datas: Object.keys(porMes).map(m => ({
            mes: m,
            sins: `${porMes[m].siniestros}`,
            porc: `${((porMes[m].siniestros / totalSiniestros) * 100).toFixed(1)}%`,
            heridos: `${porMes[m].heridos}`,
            fallecidos: `${porMes[m].fallecidos}`
        }))
    };

    await doc.table(tableMeses, {
        prepareHeader: () => doc.font("Times-Bold").fontSize(9.5).fillColor("#0F172A"),
        prepareRow: (row, idx, indexRow, rectRow) => {
            doc.font("Times-Roman").fontSize(9.5).fillColor("#1E293B");
            if (indexRow % 2 !== 0) doc.addBackground(rectRow, "#F8FAFC", 1);
        },
        padding: 4
    });

    doc.moveDown(0.8);
    doc.fillColor(cPrimary).fontSize(13).font('Times-Bold').text("6. Factores Recurrentes y Actores Viales Identificados", 40, doc.y);
    doc.moveDown(0.4);

    const tableFactores = {
        headers: [
            { label: "Factor / Actor Involucrado", property: "factor", width: 220 },
            { label: "Incidentes Asociados", property: "count", width: 130, align: "right" },
            { label: "Porcentaje sobre Total", property: "porc", width: 145, align: "right" }
        ],
        datas: [
            { factor: "Taxis / Servicio Público Involucrados", count: `${factoresCount.Taxis}`, porc: `${((factoresCount.Taxis / totalSiniestros) * 100).toFixed(1)}%` },
            { factor: "Motocicletas Involucradas", count: `${factoresCount.Motos}`, porc: `${((factoresCount.Motos / totalSiniestros) * 100).toFixed(1)}%` },
            { factor: "Camionetas y Vehículos de Carga", count: `${factoresCount.Camionetas_Carga}`, porc: `${((factoresCount.Camionetas_Carga / totalSiniestros) * 100).toFixed(1)}%` },
            { factor: "Volcamientos / Pérdida de Pista / Estrellamientos", count: `${factoresCount.Volcamientos_ChoquesFijos}`, porc: `${((factoresCount.Volcamientos_ChoquesFijos / totalSiniestros) * 100).toFixed(1)}%` },
            { factor: "Atropellamientos (Peatones / Ciclistas)", count: `${factoresCount.Peatones_Ciclistas}`, porc: `${((factoresCount.Peatones_Ciclistas / totalSiniestros) * 100).toFixed(1)}%` },
            { factor: "Buses / Transporte Colectivo", count: `${factoresCount.Buses}`, porc: `${((factoresCount.Buses / totalSiniestros) * 100).toFixed(1)}%` },
            { factor: "Presunta Ingesta de Alcohol / Ebriedad", count: `${factoresCount.Alcohol_Ebriedad}`, porc: `${((factoresCount.Alcohol_Ebriedad / totalSiniestros) * 100).toFixed(1)}%` }
        ]
    };

    await doc.table(tableFactores, {
        prepareHeader: () => doc.font("Times-Bold").fontSize(9.5).fillColor("#0F172A"),
        prepareRow: (row, idx, indexRow, rectRow) => {
            doc.font("Times-Roman").fontSize(9.5).fillColor("#1E293B");
            if (indexRow % 2 !== 0) doc.addBackground(rectRow, "#F8FAFC", 1);
        },
        padding: 5
    });

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.rect(40, doc.page.height - 48, doc.page.width - 80, 1).fill('#CBD5E1');
        doc.fillColor('#64748B').fontSize(8.5).font('Times-Roman').text(
            `Geoportal Analítico de Seguridad Vial Riobamba — Base de Datos Sincronizada con Supabase`,
            40, doc.page.height - 38
        );
        doc.fillColor('#64748B').fontSize(8.5).font('Times-Bold').text(
            `Página ${i + 1} de ${pages.count}`,
            doc.page.width - 110, doc.page.height - 38, { align: 'right' }
        );
    }

    doc.end();
    console.log("Reporte PDF actualizado exitosamente en:", pdfPath);
}

main().catch(err => {
    console.error("Error en generar_analisis.js:", err);
    process.exit(1);
});
