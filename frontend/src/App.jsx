import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Marker, LayersControl, useMap, useMapEvents } from 'react-leaflet';
import { Upload, Map as MapIcon, Download, Loader2, FileText, File, FileCode, Code, Eye, Layers } from 'lucide-react';
import axios from 'axios';
import './index.css';

// Fix Leaflet default icon issue
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow
});
L.Marker.prototype.options.icon = DefaultIcon;

// Helper to create vertex number HTML marker
const createNumberIcon = (num, isActive = false) => {
  return L.divIcon({
    className: `vertex-number-marker ${isActive ? 'active-vertex' : ''}`,
    html: `<div>${num}</div>`,
    iconSize: isActive ? [34, 34] : [24, 24],
    iconAnchor: isActive ? [17, 17] : [12, 12]
  });
};

// Helper to create blinking flow arrow HTML marker
const createArrowIcon = (angle) => {
  return L.divIcon({
    className: 'flow-arrow-marker',
    html: `<div style="transform: rotate(${angle}deg);"><svg width="26" height="26" viewBox="0 0 24 24" fill="#ff2222" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 22l10-4 10 4L12 2z"/></svg></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
};

const createStartIcon = () => {
  return L.divIcon({
    className: 'start-marker',
    html: `<div style="font-size: 24px;">📍</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24]
  });
};

const createEndIcon = () => {
  return L.divIcon({
    className: 'end-marker',
    html: `<div style="font-size: 24px;">🏁</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 24]
  });
};

function MapUpdater({ polygon }) {
  const map = useMap();
  React.useEffect(() => {
    if (polygon && polygon.length > 0) {
      map.fitBounds(polygon);
    }
  }, [polygon, map]);
  return null;
}

function MapFocusHandler({ activeVertex }) {
  const map = useMap();
  React.useEffect(() => {
    if (activeVertex) {
      map.panTo([activeVertex.lat, activeVertex.lng], { animate: true, duration: 0.3 });
    }
  }, [activeVertex, map]);
  return null;
}

function MapClickHandler({ selectingMode, setStartPoint, setEndPoint, setSelectingMode }) {
  useMapEvents({
    click(e) {
      if (selectingMode === 'start') {
        setStartPoint([e.latlng.lat, e.latlng.lng]);
        setSelectingMode(null);
      } else if (selectingMode === 'end') {
        setEndPoint([e.latlng.lat, e.latlng.lng]);
        setSelectingMode(null);
      }
    },
  });
  return null;
}

function App() {
  const [polygonCoords, setPolygonCoords] = useState(null);
  const [routeGeoJSON, setRouteGeoJSON] = useState(null);
  const [tableData, setTableData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  
  const [routePath, setRoutePath] = useState([]);
  const [speedKmH, setSpeedKmH] = useState(10);

  // New features state
  const [showNumbers, setShowNumbers] = useState(false);
  const [showArrows, setShowArrows] = useState(false);
  const [singlePassTwoWay, setSinglePassTwoWay] = useState(true);
  const [ignoreUTurns, setIgnoreUTurns] = useState(true);
  const [avoidPrivate, setAvoidPrivate] = useState(true);
  const [minVertexDistance, setMinVertexDistance] = useState(25);
  const [currentVertexIdx, setCurrentVertexIdx] = useState(0);

  const [startPoint, setStartPoint] = useState(null);
  const [endPoint, setEndPoint] = useState(null);
  const [selectingMode, setSelectingMode] = useState(null); // 'start' or 'end' or null

  // Calculations
  const totalDistanceMeters = tableData.reduce((acc, row) => acc + parseFloat(row.distancia_m), 0);
  const totalDistanceKm = (totalDistanceMeters / 1000).toFixed(2);
  const timeHours = speedKmH > 0 ? totalDistanceKm / speedKmH : 0;
  const timeMinutes = Math.round(timeHours * 60);

  const formatTime = (minutes) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
  };

  const getDistanceMeters = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Helper to compute route markers (vertices & arrows) with intelligent downsampling
  const getRouteMarkers = () => {
    const vertices = [];
    const arrows = [];
    
    if (!routePath || routePath.length === 0) return { vertices, arrows };

    let lines = [];
    if (Array.isArray(routePath[0]) && Array.isArray(routePath[0][0])) {
      lines = routePath;
    } else {
      lines = [routePath];
    }

    let stepNum = 1;
    let lastVertexPt = null;
    let lastArrowPt = null;

    lines.forEach((line) => {
      line.forEach((pt, idx) => {
        const isFirstInLine = idx === 0;
        
        let shouldAddVertex = false;
        if (!lastVertexPt) {
          shouldAddVertex = true;
        } else {
          const dist = getDistanceMeters(lastVertexPt[0], lastVertexPt[1], pt[0], pt[1]);
          if (dist >= minVertexDistance || isFirstInLine) {
            shouldAddVertex = true;
          }
        }

        if (shouldAddVertex) {
          vertices.push({ lat: pt[0], lng: pt[1], num: stepNum++ });
          lastVertexPt = pt;
        }

        if (idx < line.length - 1) {
          const pt1 = line[idx];
          const pt2 = line[idx + 1];
          const segDist = getDistanceMeters(pt1[0], pt1[1], pt2[0], pt2[1]);
          
          let shouldAddArrow = false;
          if (!lastArrowPt) {
            shouldAddArrow = true;
          } else {
            const distFromLastArrow = getDistanceMeters(lastArrowPt[0], lastArrowPt[1], pt1[0], pt1[1]);
            if (distFromLastArrow >= 40) {
              shouldAddArrow = true;
            }
          }

          if (shouldAddArrow && segDist >= 4) {
            const midLat = (pt1[0] + pt2[0]) / 2;
            const midLng = (pt1[1] + pt2[1]) / 2;
            const dLat = pt2[0] - pt1[0];
            const dLng = pt2[1] - pt1[1];
            const angle = Math.atan2(dLng, dLat) * (180 / Math.PI);
            
            arrows.push({ lat: midLat, lng: midLng, angle });
            lastArrowPt = [midLat, midLng];
          }
        }
      });
    });

    return { vertices, arrows };
  };

  const { vertices, arrows } = getRouteMarkers();

  // Keyboard navigation for vertex numbers (ArrowLeft / ArrowRight)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!vertices || vertices.length === 0) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setShowNumbers(true);
        setCurrentVertexIdx((prev) => Math.min(prev + 1, vertices.length - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setShowNumbers(true);
        setCurrentVertexIdx((prev) => Math.max(prev - 1, 0));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [vertices]);

  const API_URL = 'http://127.0.0.1:8000';

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setIsLoading(true);
    try {
      const response = await axios.post(`${API_URL}/upload-kml`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const latLngs = response.data.polygon.map(pt => [pt[1], pt[0]]);
      setPolygonCoords(latLngs);
      setRouteGeoJSON(null);
      setTableData([]);
      setRoutePath([]);
      setCurrentVertexIdx(0);
    } catch (error) {
      alert("Erro ao validar KML: " + (error.response?.data?.detail || error.message));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCalculate = async () => {
    if (!polygonCoords) return;
    
    setIsCalculating(true);
    try {
      const reqCoords = polygonCoords.map(pt => [pt[1], pt[0]]);
      const response = await axios.post(`${API_URL}/calculate`, { 
        coordinates: reqCoords,
        single_pass_twoway: singlePassTwoWay,
        ignore_u_turns: ignoreUTurns,
        avoid_private: avoidPrivate,
        start_point: startPoint,
        end_point: endPoint
      });
      
      setRouteGeoJSON(response.data.geojson);
      setTableData(response.data.table);
      
      const geomType = response.data.geojson.features[0].geometry.type;
      const coords = response.data.geojson.features[0].geometry.coordinates;
      let routePoints = [];
      
      if (geomType === 'MultiLineString') {
        routePoints = coords.map(line => line.map(pt => [pt[1], pt[0]]));
      } else {
        routePoints = coords.map(pt => [pt[1], pt[0]]);
      }
      
      setRoutePath(routePoints);
      setCurrentVertexIdx(0);
      
    } catch (error) {
      alert("Erro ao calcular rota: " + (error.response?.data?.detail || error.message));
    } finally {
      setIsCalculating(false);
    }
  };

  const handleExport = async (format) => {
    try {
      const response = await axios.post(`${API_URL}/export/${format}`, {
        table: tableData,
        geojson: routeGeoJSON
      }, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `rota.${format}`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      alert(`Erro ao exportar ${format}`);
    }
  };

  return (
    <div className="App">
      <header className="header">
        <img 
          src="https://ambiental.sc/wp-content/themes/ambiental-03/src/img/ambiental.svg" 
          alt="Ambiental Logo" 
          className="header-logo-img" 
        />
        <div className="header-title">
          <span>Ambiental</span> Rotas
        </div>
      </header>

      <div className="main-container">
        
        {/* Left side: Map */}
        <div className="map-section">
          
          {/* Visual Toggles & Navigation Toolbar */}
          {routePath.length > 0 && (
            <div className="map-toolbar" style={{ justifyContent: 'space-between' }}>
              <div className="nav-controls-bar">
                <span>Navegar Vértices:</span>
                <button 
                  className="nav-btn" 
                  disabled={currentVertexIdx <= 0}
                  onClick={() => {
                    setShowNumbers(true);
                    setCurrentVertexIdx(prev => Math.max(prev - 1, 0));
                  }}
                >
                  ◀ Anterior
                </button>
                <span style={{ fontWeight: '700', color: 'var(--primary-color)' }}>
                  {vertices.length > 0 ? `${currentVertexIdx + 1} / ${vertices.length}` : '0 / 0'}
                </span>
                <button 
                  className="nav-btn" 
                  disabled={currentVertexIdx >= vertices.length - 1}
                  onClick={() => {
                    setShowNumbers(true);
                    setCurrentVertexIdx(prev => Math.min(prev + 1, vertices.length - 1));
                  }}
                >
                  Próximo ▶
                </button>
                <span style={{ fontSize: '0.78rem', color: '#666', marginLeft: '6px' }}>
                  (Teclas ◄ e ►)
                </span>
              </div>

              <div className="map-toolbar-group">
                <label className="map-toggle-label" style={{ gap: '6px' }}>
                  <span>Espaçamento:</span>
                  <select 
                    value={minVertexDistance} 
                    onChange={(e) => {
                      setMinVertexDistance(Number(e.target.value));
                      setCurrentVertexIdx(0);
                    }}
                    style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '2px 6px', fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    <option value={15}>15m (Detalhado)</option>
                    <option value={25}>25m (Recomendado)</option>
                    <option value={50}>50m (Espaçado)</option>
                    <option value={100}>100m (Principal)</option>
                  </select>
                </label>
                <label className="map-toggle-label">
                  <input 
                    type="checkbox" 
                    checked={showNumbers} 
                    onChange={(e) => setShowNumbers(e.target.checked)} 
                  />
                  <span>🔢 Números dos Vértices</span>
                </label>
                <label className="map-toggle-label">
                  <input 
                    type="checkbox" 
                    checked={showArrows} 
                    onChange={(e) => setShowArrows(e.target.checked)} 
                  />
                  <span>➔ Setas de Sentido (Piscando)</span>
                </label>
              </div>
            </div>
          )}

          <div className="map-container" style={{ cursor: selectingMode ? 'crosshair' : 'default' }}>
            <MapContainer center={[-26.3045, -48.846]} zoom={15} maxZoom={22} style={{ height: '100%', width: '100%' }}>
              <MapClickHandler 
                selectingMode={selectingMode} 
                setStartPoint={setStartPoint} 
                setEndPoint={setEndPoint} 
                setSelectingMode={setSelectingMode} 
              />
              
              {/* LayersControl directly below zoom buttons (+/-) */}
              <LayersControl position="topleft">
                <LayersControl.BaseLayer checked name="Mapa Padrão (OSM)">
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={22}
                    maxNativeZoom={19}
                    attribution='&copy; OpenStreetMap contributors'
                  />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Satélite ESRI">
                  <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    maxZoom={22}
                    maxNativeZoom={19}
                    attribution='&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS'
                  />
                </LayersControl.BaseLayer>
              </LayersControl>

              <MapUpdater polygon={polygonCoords} />
              
              {showNumbers && vertices.length > 0 && (
                <MapFocusHandler activeVertex={vertices[currentVertexIdx]} />
              )}
              
              {polygonCoords && (
                <Polygon positions={polygonCoords} pathOptions={{ color: '#98c43d', fillColor: '#98c43d', fillOpacity: 0.2 }} />
              )}
              
              {routePath.length > 0 && (
                <Polyline positions={routePath} pathOptions={{ color: '#2b5a9e', weight: 4 }} />
              )}

              {/* Vertex Number Markers */}
              {showNumbers && vertices.map((v, idx) => (
                <Marker 
                  key={`v-${idx}`} 
                  position={[v.lat, v.lng]} 
                  icon={createNumberIcon(v.num, idx === currentVertexIdx)} 
                  zIndexOffset={idx === currentVertexIdx ? 1000 : 0}
                />
              ))}

              {/* Blinking Flow Arrow Markers */}
              {showArrows && arrows.map((a, idx) => (
                <Marker 
                  key={`a-${idx}`} 
                  position={[a.lat, a.lng]} 
                  icon={createArrowIcon(a.angle)} 
                />
              ))}

              {/* Start and End Markers */}
              {startPoint && (
                <Marker position={startPoint} icon={createStartIcon()} zIndexOffset={2000} />
              )}
              {endPoint && (
                <Marker position={endPoint} icon={createEndIcon()} zIndexOffset={2000} />
              )}
            </MapContainer>
          </div>
        </div>

        {/* Right side: Sidebar tools */}
        <div className="sidebar">
          
          {/* Card 1: Import & Validate */}
          <div className="card">
            <h2>Importar Área (KML)</h2>
            <p className="card-desc">
              Selecione um arquivo KML contendo o polígono da área a ser mapeada.
            </p>
            
            <div className="file-input-wrapper">
              <button className="button-primary">
                {isLoading ? <Loader2 className="loader" /> : <Upload size={20} />}
                Selecionar e Validar KML
              </button>
              <input type="file" accept=".kml" onChange={handleFileUpload} />
            </div>
            
            {polygonCoords && (
              <div style={{ marginTop: '15px' }}>
                <p style={{ color: 'var(--primary-color)', fontSize: '0.9rem', fontWeight: '500', marginBottom: '10px' }}>
                  ✓ Área carregada com sucesso!
                </p>
                <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                  <button 
                    className="button-primary" 
                    style={{ background: selectingMode === 'start' ? '#ff9800' : '#f0f0f0', color: selectingMode === 'start' ? '#fff' : '#333', border: '1px solid #ccc' }}
                    onClick={() => setSelectingMode('start')}
                  >
                    📍 {startPoint ? 'Entrada Definida (Clique para alterar)' : 'Definir Ponto de Entrada'}
                  </button>
                  <button 
                    className="button-primary" 
                    style={{ background: selectingMode === 'end' ? '#ff9800' : '#f0f0f0', color: selectingMode === 'end' ? '#fff' : '#333', border: '1px solid #ccc' }}
                    onClick={() => setSelectingMode('end')}
                  >
                    🏁 {endPoint ? 'Saída Definida (Clique para alterar)' : 'Definir Ponto de Saída'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Calculate */}
          <div className="card" style={{ opacity: polygonCoords ? 1 : 0.5 }}>
            <h2>Calcular Melhor Rota</h2>
            <p className="card-desc">
              Gerar percurso inteligente que cubra todas as ruas dentro da área selecionada.
            </p>
            
            <div style={{ marginBottom: '15px', background: '#f8f9fa', padding: '10px 12px', borderRadius: '8px', border: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#444' }}>
                <input 
                  type="checkbox" 
                  checked={singlePassTwoWay} 
                  onChange={(e) => setSinglePassTwoWay(e.target.checked)} 
                />
                <span>Passada Única em Ruas de Mão Dupla (Evita repetição de rota)</span>
              </label>
              <label style={{ fontSize: '0.85rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#444' }}>
                <input 
                  type="checkbox" 
                  checked={ignoreUTurns} 
                  onChange={(e) => setIgnoreUTurns(e.target.checked)} 
                />
                <span>Ignorar Retornos / Travessias de Canteiro Desnecessários</span>
              </label>
              <label style={{ fontSize: '0.85rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#444' }}>
                <input 
                  type="checkbox" 
                  checked={avoidPrivate} 
                  onChange={(e) => setAvoidPrivate(e.target.checked)} 
                />
                <span>Evitar Locais Privados (Condomínios)</span>
              </label>
            </div>
            
            <button 
              className="button-primary" 
              onClick={handleCalculate}
              disabled={!polygonCoords || isCalculating}
            >
              {isCalculating ? <Loader2 className="loader" /> : <MapIcon size={20} />}
              {isCalculating ? 'Processando Malha Viária...' : 'Gerar Rota Otimizada'}
            </button>
          </div>

          {/* Card 3: Results & Export */}
          {tableData.length > 0 && (
            <div className="card">
              <h2>Resultados</h2>
              
              <div className="stats-container">
                <div className="stats-row">
                  <span className="stats-label">Distância Total:</span>
                  <span className="stats-value">{totalDistanceKm} km</span>
                </div>
                <div className="stats-row" style={{ marginTop: '5px', marginBottom: '10px' }}>
                  <span className="stats-label">
                    Velocidade Média:
                    <input 
                      type="number" 
                      className="speed-input" 
                      value={speedKmH} 
                      onChange={(e) => setSpeedKmH(Number(e.target.value))} 
                      min="1" 
                      max="100" 
                    />
                    <span style={{ fontSize: '0.85rem', color: '#666', marginLeft: '5px' }}>km/h</span>
                  </span>
                </div>
                <div className="stats-row" style={{ borderTop: '1px dashed #c8e19b', paddingTop: '10px' }}>
                  <span className="stats-label">Tempo de Percurso:</span>
                  <span className="stats-value">{formatTime(timeMinutes)}</span>
                </div>
              </div>
              
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Direção</th>
                      <th>Rua / Trecho</th>
                      <th>Distância</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map((row, idx) => {
                      const isActiveRow = currentVertexIdx === idx;
                      const dirText = row.direcao || 'Siga em frente';
                      
                      let dirStyle = { background: '#e2e8f0', color: '#334155' };
                      if (dirText.includes('direita')) {
                        dirStyle = { background: '#e0f2fe', color: '#0369a1' };
                      } else if (dirText.includes('esquerda')) {
                        dirStyle = { background: '#f0fdf4', color: '#15803d' };
                      } else if (dirText.includes('retorno')) {
                        dirStyle = { background: '#fef3c7', color: '#b45309' };
                      } else if (dirText.includes('Início') || dirText.includes('Inicio')) {
                        dirStyle = { background: '#f3e8ff', color: '#6b21a8' };
                      }

                      return (
                        <tr 
                          key={idx}
                          className={isActiveRow ? 'tr-active-step' : ''}
                          onClick={() => {
                            setShowNumbers(true);
                            setCurrentVertexIdx(idx);
                          }}
                          style={{ cursor: 'pointer' }}
                        >
                          <td><b>#{row.passo}</b></td>
                          <td>
                            <span style={{ 
                              display: 'inline-block', 
                              padding: '3px 7px', 
                              borderRadius: '4px', 
                              fontSize: '0.75rem', 
                              fontWeight: '600',
                              ...dirStyle 
                            }}>
                              {dirText}
                            </span>
                          </td>
                          <td>{row.rua}</td>
                          <td>{row.distancia_m}m</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p style={{marginBottom: '10px', fontSize: '0.95rem', fontWeight: '500', color: 'var(--heading-color)'}}>
                Baixar Relatório Oficial:
              </p>
              <div className="export-grid">
                <button className="button-outline" onClick={() => handleExport('docx')}>
                  <FileText size={18} /> DOCX
                </button>
                <button className="button-outline" onClick={() => handleExport('pdf')}>
                  <File size={18} /> PDF
                </button>
                <button className="button-outline" onClick={() => handleExport('kml')}>
                  <MapIcon size={18} /> KML
                </button>
                <button className="button-outline" onClick={() => handleExport('html')}>
                  <Code size={18} /> HTML
                </button>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}

export default App;
