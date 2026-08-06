"""
mixed_cpp_solver.py
====================

Solver heurístico para o "Route Inspection Problem" (Problema do Carteiro
Chinês) em grafos MISTOS -- ou seja, ruas de mão única (arestas dirigidas)
misturadas com ruas de mão dupla (arestas não-dirigidas).

Objetivo: dado um polígono de área e um nó de entrada (e opcionalmente de
saída), encontrar uma rota que percorra TODAS as ruas dentro do polígono,
respeitando o sentido de tráfego, minimizando a distância/tempo total
percorrido (incluindo trechos repetidos quando inevitável).

Pipeline:
  1. Baixa a malha viária do OpenStreetMap dentro do polígono (via OSMnx).
     OSMnx já resolve "oneway" -> arestas dirigidas corretamente.
  2. Constrói um MultiDiGraph onde:
       - rua de mão dupla  -> duas arestas dirigidas (u->v e v->u)
       - rua de mão única  -> uma única aresta dirigida
  3. Balanceia o grafo (todo nó deve ter in_degree == out_degree) usando
     fluxo de custo mínimo -- duplica virtualmente os trechos mais baratos
     necessários para tornar o grafo Euleriano.
  4. Extrai um circuito Euleriano (Hierholzer, via NetworkX) = a rota.
  5. Exporta a rota como GeoJSON (LineString) pronta para abrir no QGIS.

LIMITAÇÃO IMPORTANTE:
  O Mixed Chinese Postman Problem exato é NP-difícil em geral. Esta
  implementação usa uma heurística amplamente utilizada na prática:
  trata arestas de mão dupla como pares de arcos opostos e resolve o
  balanceamento como um problema de fluxo de custo mínimo (que é a solução
  EXATA para o caso 100% dirigido e para o caso 100% não-dirigido, e uma
  BOA aproximação para o caso misto). Para malhas viárias reais isso
  normalmente produz rotas muito próximas do ótimo.

Requisitos:
  pip install osmnx networkx shapely
"""

import json
import networkx as nx
from shapely.geometry import Polygon

try:
    import osmnx as ox
except ImportError:
    ox = None  # permite rodar as funções de grafo sem osmnx instalado


# ---------------------------------------------------------------------------
# 1. Extração da malha viária
# ---------------------------------------------------------------------------

def build_graph_from_polygon(polygon: Polygon, network_type: str = "drive") -> "nx.DiGraph":
    """
    Baixa a malha viária do OpenStreetMap recortada pelo polígono.
    Retorna um DiGraph do OSMnx já respeitando sentido de tráfego (oneway).
    """
    if ox is None:
        raise ImportError("Instale osmnx: pip install osmnx")

    G = ox.graph_from_polygon(polygon, network_type=network_type, simplify=True, truncate_by_edge=True)
    # get_digraph colapsa arestas paralelas mantendo a de menor peso,
    # e já reflete corretamente ruas de mão única vs. mão dupla.
    G = ox.convert.to_digraph(G, weight="length")
    return G


# ---------------------------------------------------------------------------
# 2. Conversão para MultiDiGraph de trabalho
# ---------------------------------------------------------------------------

def to_working_multidigraph(G_input, weight: str = "length") -> nx.MultiDiGraph:
    """
    Converte o grafo de entrada em um MultiDiGraph de trabalho,
    identificando arestas opcionais (retornos, alças, acessos) que não
    possuem coleta de lixo obrigatória.
    """
    G = nx.MultiDiGraph()
    for n, data in G_input.nodes(data=True):
        G.add_node(n, x=data.get("x"), y=data.get("y"))
    for u, v, data in G_input.edges(data=True):
        name = data.get("name", "Desconhecida")
        if isinstance(name, list):
            name = ", ".join(name)
        
        highway = data.get("highway", "")
        if isinstance(highway, list):
            highway = " ".join(highway)
        junction = data.get("junction", "")
        name_str = str(name).lower()
        
        # Identifica se é retorno / alça de acesso / serviço sem coleta
        is_optional = (
            any(str(highway).endswith(s) for s in ["_link", "service"]) or
            junction in ["roundabout", "circular", "turnaround"] or
            any(k in name_str for k in ["retorno", "alça", "acesso", "turnaround"])
        )
        
        G.add_edge(u, v, length=float(data.get(weight, 1.0)), osmid=data.get("osmid"), name=name, optional=is_optional)
    return G


# ---------------------------------------------------------------------------
# 3. Balanceamento do grafo (torná-lo Euleriano)
# ---------------------------------------------------------------------------

def compute_imbalance(G: nx.MultiDiGraph) -> dict:
    """out_degree - in_degree para cada nó. Positivo = 'sobra saída', negativo = 'sobra entrada'."""
    return {n: G.out_degree(n) - G.in_degree(n) for n in G.nodes()}


def balance_graph(G_req: nx.MultiDiGraph, G_all: nx.MultiDiGraph = None, weight: str = "length") -> nx.MultiDiGraph:
    """
    Duplica virtualmente os trechos necessários para que todo nó de G_req tenha
    in_degree == out_degree. Os caminhos mais curtos para balanceamento são
    buscados em G_all (permitindo usar retornos/alças apenas como travessia).
    """
    if G_all is None:
        G_all = G_req

    imbalance = compute_imbalance(G_req)
    surplus = {n: v for n, v in imbalance.items() if v > 0}
    deficit = {n: -v for n, v in imbalance.items() if v < 0}

    if not surplus and not deficit:
        return G_req.copy()

    total = sum(surplus.values())
    assert total == sum(deficit.values()), "Grafo desconectado ou inconsistente."

    aux = nx.DiGraph()
    aux.add_node("SOURCE", demand=-total)
    aux.add_node("SINK", demand=total)
    for n, cap in surplus.items():
        aux.add_edge("SOURCE", n, capacity=cap, weight=0)
    for n, cap in deficit.items():
        aux.add_edge(n, "SINK", capacity=cap, weight=0)

    shortest_paths = {}
    for idx, d in enumerate(deficit):
        lengths, paths = nx.single_source_dijkstra(G_all, d, weight=weight)
        for s in surplus:
            if s in lengths:
                aux.add_edge(s, d, capacity=min(surplus[s], deficit[d]), weight=int(lengths[s] * 1000))
                shortest_paths[(s, d)] = paths[s]

    try:
        flow_dict = nx.max_flow_min_cost(aux, "SOURCE", "SINK", capacity="capacity", weight="weight")
    except Exception as e:
        print("    [DEBUG] Error in max_flow_min_cost:", e)
        raise

    G_res = G_req.copy()
    for s in surplus:
        for d in deficit:
            f = flow_dict.get(s, {}).get(d, 0)
            if f <= 0:
                continue
            path = shortest_paths[(s, d)]
            for _ in range(f):
                for u, v in zip(path[:-1], path[1:]):
                    edge_data = G_all.get_edge_data(u, v)
                    best_key = min(edge_data, key=lambda k: edge_data[k][weight])
                    G_res.add_edge(u, v, length=edge_data[best_key][weight],
                                osmid=edge_data[best_key].get("osmid"), 
                                name=edge_data[best_key].get("name", "Desconhecida"), 
                                duplicated=True)
    return G_res


# ---------------------------------------------------------------------------
# 4. Extração da rota (circuito/caminho Euleriano)
# ---------------------------------------------------------------------------

def solve_route(G_raw: nx.MultiDiGraph, start_node, end_node=None, weight: str = "length") -> list:
    """
    Recebe o grafo completo G_raw e calcula a rota Euleriana.
    Arestas opcionais (retornos/alças) são usadas APENAS para manobras de travessia.
    """
    # Separa arestas obrigatórias (coleta) vs opcionais (retornos)
    G_req = nx.MultiDiGraph()
    for n, data in G_raw.nodes(data=True):
        G_req.add_node(n, **data)
    
    req_edges_count = 0
    for u, v, k, data in G_raw.edges(keys=True, data=True):
        if not data.get("optional", False):
            G_req.add_edge(u, v, key=k, **data)
            req_edges_count += 1
            
    # Se não houver arestas obrigatórias filtradas, usa G_raw inteiro
    if req_edges_count == 0:
        G_req = G_raw.copy()

    if start_node not in G_req:
        start_node = list(G_req.nodes)[0]

    open_path = end_node is not None and end_node != start_node and end_node in G_req
    if open_path:
        G_req.add_edge(end_node, start_node, length=0.0, virtual=True)

    # Balanceia os graus de G_req usando caminhos mais curtos de G_raw
    G_bal = balance_graph(G_req, G_all=G_raw, weight=weight)

    # Conecta componentes fortes desconexos adicionando ciclos de ida e volta
    # (isso preserva in_degree == out_degree para todos os nós e torna o grafo conexo)
    active_sccs = [
        c for c in nx.strongly_connected_components(G_bal)
        if G_bal.subgraph(c).number_of_edges() > 0
    ]

    if len(active_sccs) > 1:
        main_scc = max(active_sccs, key=len)
        for other_scc in active_sccs:
            if other_scc == main_scc:
                continue
            u = list(main_scc)[0]
            v = list(other_scc)[0]
            try:
                p1 = nx.shortest_path(G_raw, u, v, weight=weight)
                p2 = nx.shortest_path(G_raw, v, u, weight=weight)
                for path in [p1, p2]:
                    for edge_u, edge_v in zip(path[:-1], path[1:]):
                        edge_data = G_raw.get_edge_data(edge_u, edge_v)
                        best_key = min(edge_data, key=lambda k: edge_data[k][weight])
                        G_bal.add_edge(edge_u, edge_v, **edge_data[best_key])
            except nx.NetworkXNoPath:
                pass

    # Garante que o start_node pertence ao componente com arestas
    valid_nodes = [n for n in G_bal.nodes() if G_bal.degree(n) > 0]
    if start_node not in valid_nodes and valid_nodes:
        start_node = valid_nodes[0]

    circuit = list(nx.eulerian_circuit(G_bal, source=start_node, keys=True))

    if open_path:
        for i, (u, v, k) in enumerate(circuit):
            if G_bal.edges[u, v, k].get("virtual"):
                circuit = circuit[i + 1:] + circuit[:i]
                break

    route_nodes = [circuit[0][0]] + [v for _, v, _ in circuit] if circuit else [start_node]
    return route_nodes


# ---------------------------------------------------------------------------
# 5. Exportação para GeoJSON (uso no QGIS)
# ---------------------------------------------------------------------------

def route_to_geojson(G: nx.MultiDiGraph, route_nodes: list, out_path: str = "rota_resultado.geojson"):
    coords = []
    for n in route_nodes:
        data = G.nodes[n]
        coords.append([data["x"], data["y"]])

    total_length = sum(
        min(G.get_edge_data(u, v).values(), key=lambda d: d["length"])["length"]
        for u, v in zip(route_nodes[:-1], route_nodes[1:])
    )

    geojson = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "n_nodes": len(route_nodes),
                "n_edges": len(route_nodes) - 1,
                "total_length_m": round(total_length, 1),
            }
        }]
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)
    return out_path


def export_route_table(G: nx.MultiDiGraph, route_nodes: list, out_path: str = "tabela_rota.csv"):
    import csv
    with open(out_path, mode="w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter=';')
        writer.writerow(["Passo", "Rua", "Distancia_m"])
        for i, (u, v) in enumerate(zip(route_nodes[:-1], route_nodes[1:])):
            edge_data = G.get_edge_data(u, v)
            best_key = min(edge_data, key=lambda k: edge_data[k]["length"])
            data = edge_data[best_key]
            writer.writerow([i + 1, data.get("name", "Desconhecida"), round(data["length"], 2)])
    return out_path


# ---------------------------------------------------------------------------
# Execução de exemplo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # SUBSTITUA pelas coordenadas reais do seu polígono (lon, lat)
    polygon_coords = [
        (-48.848, -26.300), (-48.840, -26.300),
        (-48.840, -26.310), (-48.848, -26.310),
    ]
    polygon = Polygon(polygon_coords)

    print("1) Baixando malha viária do OpenStreetMap dentro do polígono...")
    G_osm = build_graph_from_polygon(polygon)
    print(f"   Nós: {len(G_osm.nodes)}  Arestas: {len(G_osm.edges)}")

    print("2) Convertendo para grafo de trabalho...")
    G = to_working_multidigraph(G_osm)
    
    # IMPORTANTE: malhas viárias recortadas quase nunca são fortemente conexas 
    # (ruas cortadas no meio, mãos únicas sem retorno).
    # Precisamos extrair o maior componente fortemente conexo.
    largest_scc = max(nx.strongly_connected_components(G), key=len)
    G = G.subgraph(largest_scc).copy()
    print(f"   Grafo Fortemente Conexo: {len(G.nodes)} nós, {len(G.edges)} arestas")

    # troque pelos nós reais de entrada/saída do caminhão/veículo
    start_node = list(G.nodes)[0]
    end_node = start_node  # ou outro nó, se a rota não precisar ser um circuito fechado

    print(f"3) Balanceando grafo e calculando rota Euleriana a partir de {start_node}...")
    route = solve_route(G, start_node, end_node)

    print("5) Exportando GeoJSON...")
    out_file = route_to_geojson(G, route)
    print(f"   Rota salva em: {out_file}  ({len(route)} nós na sequência)")
    
    print("6) Exportando tabela de ruas (CSV)...")
    out_csv = export_route_table(G, route)
    print(f"   Tabela salva em: {out_csv}")
