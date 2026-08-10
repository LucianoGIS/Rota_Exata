from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import xml.etree.ElementTree as ET
from shapely.geometry import Polygon
import json
import os
import io
from fastapi.responses import Response

# Import the existing solver functions
from mixed_cpp_solver import build_graph_from_polygon, to_working_multidigraph, solve_route, route_to_geojson, export_route_table
import networkx as nx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CalculateRequest(BaseModel):
    coordinates: list
    single_pass_twoway: bool = True
    ignore_u_turns: bool = True

@app.post("/upload-kml")
async def upload_kml(file: UploadFile = File(...)):
    contents = await file.read()
    try:
        # Parse KML
        root = ET.fromstring(contents)
        ns = {'kml': 'http://www.opengis.net/kml/2.2'}
        # Find first Polygon coordinates
        coords_node = root.find('.//kml:Polygon//kml:coordinates', ns)
        if coords_node is None:
            # Fallback namespace or lack thereof
            coords_node = root.find('.//Polygon//coordinates')
            
        if coords_node is None:
            raise HTTPException(status_code=400, detail="Nenhum polígono encontrado no KML.")
            
        coords_str = coords_node.text.strip()
        points = []
        for pair in coords_str.split():
            parts = pair.split(',')
            if len(parts) >= 2:
                points.append([float(parts[0]), float(parts[1])]) # lon, lat
                
        if len(points) < 3:
            raise HTTPException(status_code=400, detail="Polígono inválido.")
            
        return {"polygon": points}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/calculate")
async def calculate_route(req: CalculateRequest):
    try:
        polygon_coords = req.coordinates
        polygon = Polygon(polygon_coords)
        
        G_osm = build_graph_from_polygon(polygon)
        G = to_working_multidigraph(G_osm, single_pass_twoway=req.single_pass_twoway, ignore_u_turns=req.ignore_u_turns)
        
        largest_scc = max(nx.strongly_connected_components(G), key=len)
        G = G.subgraph(largest_scc).copy()
        
        start_node = list(G.nodes)[0]
        route = solve_route(G, start_node, start_node)
        
        # Build table data and continuous single LineString coordinates
        table_data = []
        full_route_coords = []
        
        for i, (u, v) in enumerate(zip(route[:-1], route[1:])):
            edge_data = G.get_edge_data(u, v)
            is_reversed = False
            if not edge_data:
                edge_data = G.get_edge_data(v, u)
                is_reversed = True
                
            u_x, u_y = G.nodes[u]['x'], G.nodes[u]['y']
            v_x, v_y = G.nodes[v]['x'], G.nodes[v]['y']
            
            step_coords = []
            if edge_data:
                best_key = min(edge_data, key=lambda k: edge_data[k].get("length", 1.0))
                data = edge_data[best_key]
                
                table_data.append({
                    "passo": i + 1,
                    "rua": data.get("name", "Desconhecida"),
                    "distancia_m": round(data.get("length", 0.0), 2)
                })
                
                if "geometry" in data:
                    coords_list = list(data["geometry"].coords)
                    if is_reversed:
                        coords_list = coords_list[::-1]
                    else:
                        d_start = (coords_list[0][0] - u_x)**2 + (coords_list[0][1] - u_y)**2
                        d_end = (coords_list[-1][0] - u_x)**2 + (coords_list[-1][1] - u_y)**2
                        if d_end < d_start:
                            coords_list = coords_list[::-1]
                    step_coords = coords_list
                else:
                    step_coords = [(u_x, u_y), (v_x, v_y)]
            else:
                # Failsafe: Roteamento físico via G_osm (garante 100% que segue vias reais)
                try:
                    path_nodes = nx.shortest_path(G_osm.to_undirected(), u, v, weight="length")
                    path_dist = 0.0
                    for sub_u, sub_v in zip(path_nodes[:-1], path_nodes[1:]):
                        sub_edge_data = G_osm.get_edge_data(sub_u, sub_v) or G_osm.get_edge_data(sub_v, sub_u)
                        if sub_edge_data:
                            best_sub_k = min(sub_edge_data, key=lambda k: sub_edge_data[k].get("length", 1.0))
                            sub_d = sub_edge_data[best_sub_k]
                            path_dist += sub_d.get("length", 0.0)
                            
                            sub_ux, sub_uy = G_osm.nodes[sub_u]['x'], G_osm.nodes[sub_u]['y']
                            if "geometry" in sub_d:
                                sub_coords = list(sub_d["geometry"].coords)
                                d_s = (sub_coords[0][0] - sub_ux)**2 + (sub_coords[0][1] - sub_uy)**2
                                d_e = (sub_coords[-1][0] - sub_ux)**2 + (sub_coords[-1][1] - sub_uy)**2
                                if d_e < d_s:
                                    sub_coords = sub_coords[::-1]
                                step_coords.extend(sub_coords)
                            else:
                                step_coords.extend([(sub_ux, sub_uy), (G_osm.nodes[sub_v]['x'], G_osm.nodes[sub_v]['y'])])
                    
                    table_data.append({
                        "passo": i + 1,
                        "rua": "Conexão de Vias",
                        "distancia_m": round(path_dist, 2)
                    })
                except Exception:
                    table_data.append({
                        "passo": i + 1,
                        "rua": "Desconhecida",
                        "distancia_m": 0.0
                    })
                    step_coords = [(u_x, u_y), (v_x, v_y)]

            # Concatenar step_coords em full_route_coords sem duplicar vértices adjacentes
            if not full_route_coords:
                full_route_coords.extend(step_coords)
            else:
                if step_coords:
                    if full_route_coords[-1] == step_coords[0]:
                        full_route_coords.extend(step_coords[1:])
                    else:
                        full_route_coords.extend(step_coords)
            
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": full_route_coords},
                "properties": {
                    "n_nodes": len(route),
                    "n_edges": len(route) - 1,
                }
            }]
        }
        
        return {"geojson": geojson, "table": table_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ExportRequest(BaseModel):
    table: list
    geojson: dict = None

@app.post("/export/pdf")
async def export_pdf(req: ExportRequest):
    from fpdf import FPDF
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", size=12)
    pdf.cell(200, 10, txt="Relatório de Rota Otimizada", ln=1, align='C')
    pdf.ln(10)
    
    pdf.set_font("Arial", 'B', 10)
    pdf.cell(20, 10, "Passo", 1)
    pdf.cell(120, 10, "Rua", 1)
    pdf.cell(40, 10, "Distancia (m)", 1)
    pdf.ln()
    
    pdf.set_font("Arial", '', 10)
    for row in req.table:
        pdf.cell(20, 10, str(row['passo']), 1)
        pdf.cell(120, 10, str(row['rua'])[:60], 1)
        pdf.cell(40, 10, str(row['distancia_m']), 1)
        pdf.ln()
        
    pdf_bytes = bytes(pdf.output())
    return Response(content=pdf_bytes, media_type="application/pdf", headers={"Content-Disposition": "attachment; filename=rota.pdf"})

@app.post("/export/docx")
async def export_docx(req: ExportRequest):
    from docx import Document
    doc = Document()
    doc.add_heading('Relatório de Rota Otimizada', 0)
    
    table = doc.add_table(rows=1, cols=3)
    table.style = 'Table Grid'
    hdr_cells = table.rows[0].cells
    hdr_cells[0].text = 'Passo'
    hdr_cells[1].text = 'Rua'
    hdr_cells[2].text = 'Distância (m)'
    
    for row in req.table:
        row_cells = table.add_row().cells
        row_cells[0].text = str(row['passo'])
        row_cells[1].text = str(row['rua'])
        row_cells[2].text = str(row['distancia_m'])
        
    f = io.BytesIO()
    doc.save(f)
    return Response(content=f.getvalue(), media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", headers={"Content-Disposition": "attachment; filename=rota.docx"})

@app.post("/export/html")
async def export_html(req: ExportRequest):
    html = "<html><head><meta charset='utf-8'><title>Rota Otimizada</title>"
    html += "<style>body{font-family:sans-serif;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #ccc;padding:8px;text-align:left;} th{background:#eee;}</style></head><body>"
    html += "<h2>Relatório de Rota Otimizada</h2>"
    html += "<table><tr><th>Passo</th><th>Rua</th><th>Distância (m)</th></tr>"
    for row in req.table:
        html += f"<tr><td>{row['passo']}</td><td>{row['rua']}</td><td>{row['distancia_m']}</td></tr>"
    html += "</table></body></html>"
    return Response(content=html, media_type="text/html", headers={"Content-Disposition": "attachment; filename=rota.html"})

@app.post("/export/kml")
async def export_kml(req: ExportRequest):
    import simplekml
    kml = simplekml.Kml()
    geom_type = req.geojson['features'][0]['geometry']['type']
    coords = req.geojson['features'][0]['geometry']['coordinates']
    
    if geom_type == 'MultiLineString':
        # Create a folder to group the lines
        fol = kml.newfolder(name="Rota Otimizada")
        for i, line_coords in enumerate(coords):
            fol.newlinestring(name=f"Trecho {i+1}", description="Caminho do veículo", coords=line_coords)
    else:
        kml.newlinestring(name="Rota Otimizada", description="Caminho do veículo", coords=coords)
        
    kml_str = kml.kml()
    return Response(content=kml_str, media_type="application/vnd.google-earth.kml+xml", headers={"Content-Disposition": "attachment; filename=rota.kml"})
