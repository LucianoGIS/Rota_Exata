import React, { useState } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, useMap } from 'react-leaflet';
import { Upload, Map as MapIcon, Download, Loader2, FileText, File, FileCode, Code } from 'lucide-react';
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


function MapUpdater({ polygon, route }) {
  const map = useMap();
  React.useEffect(() => {
    if (polygon && polygon.length > 0) {
      map.fitBounds(polygon);
    }
  }, [polygon, map]);
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
      // Response points are [lon, lat], Leaflet expects [lat, lon]
      const latLngs = response.data.polygon.map(pt => [pt[1], pt[0]]);
      setPolygonCoords(latLngs);
      setRouteGeoJSON(null);
      setTableData([]);
      setRoutePath([]);
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
      // API expects [lon, lat]
      const reqCoords = polygonCoords.map(pt => [pt[1], pt[0]]);
      const response = await axios.post(`${API_URL}/calculate`, { coordinates: reqCoords });
      
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
        responseType: 'blob' // Important for downloading files
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
          <div className="map-container">
            <MapContainer center={[-26.3045, -48.846]} zoom={15} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; OpenStreetMap contributors'
              />
              <MapUpdater polygon={polygonCoords} />
              
              {polygonCoords && (
                <Polygon positions={polygonCoords} pathOptions={{ color: '#98c43d', fillColor: '#98c43d', fillOpacity: 0.2 }} />
              )}
              
              {routePath.length > 0 && (
                <Polyline positions={routePath} pathOptions={{ color: '#2b5a9e', weight: 4 }} />
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
              <p style={{marginTop: '10px', color: 'var(--primary-color)', fontSize: '0.9rem', fontWeight: '500'}}>
                ✓ Área carregada com sucesso!
              </p>
            )}
          </div>

          {/* Card 2: Calculate */}
          <div className="card" style={{ opacity: polygonCoords ? 1 : 0.5 }}>
            <h2>Calcular Melhor Rota</h2>
            <p className="card-desc">
              Gerar percurso inteligente que cubra todas as ruas dentro da área selecionada.
            </p>
            
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
                      <th>Rua</th>
                      <th>Distância</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map((row, idx) => (
                      <tr key={idx}>
                        <td>{row.passo}</td>
                        <td>{row.rua}</td>
                        <td>{row.distancia_m}m</td>
                      </tr>
                    ))}
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
