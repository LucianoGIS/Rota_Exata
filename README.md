# Cobertura de Ruas com Mão Única/Dupla

Protótipo para gerar automaticamente a rota que percorre **todas as ruas**
dentro de um polígono, respeitando o sentido de tráfego (mão única/dupla),
minimizando a distância/tempo total.

## Instalação

```bash
pip install osmnx networkx shapely
```

## Uso básico

```python
from shapely.geometry import Polygon
from mixed_cpp_solver import (
    build_graph_from_polygon, to_working_multidigraph, solve_route, route_to_geojson
)

# 1. Defina seu polígono (lon, lat) — pode desenhar no QGIS e exportar as coordenadas
polygon = Polygon([
    (-48.848, -26.300), (-48.840, -26.300),
    (-48.840, -26.310), (-48.848, -26.310),
])

# 2. Baixa a malha viária real do OpenStreetMap dentro do polígono
G_osm = build_graph_from_polygon(polygon)
G = to_working_multidigraph(G_osm)

# 3. Identifique os nós de entrada/saída (os IDs vêm do OSM;
#    o jeito mais fácil é usar ox.distance.nearest_nodes(G_osm, lon, lat))
start_node = ...  # nó de entrada do caminhão
end_node = ...     # nó de saída (pode ser igual ao start, se for um circuito)

# 4. Resolve a rota (já balanceia o grafo internamente)
route = solve_route(G, start_node, end_node)

# 5. Exporta como GeoJSON para abrir no QGIS
route_to_geojson(G, route, "rota_resultado.geojson")
```

## Abrindo o resultado no QGIS

1. `Camada > Adicionar Camada > Adicionar Camada Vetorial`
2. Selecione o arquivo `rota_resultado.geojson`
3. A rota aparece como uma única `LineString` — para visualizar a ordem
   de percurso (útil pois a rota repete trechos), use o plugin
   **"Animate!"** do QGIS ou o modo de simbologia por "regra" com base na
   posição do vértice.

Para desenhar o próprio polígono da área no QGIS e exportar as coordenadas:
`Camada > Criar Camada > Nova Camada Vetorial (Polígono)` → desenhe →
clique direito na camada → `Exportar > Salvar Feições Como...` → GeoJSON.
Depois é só ler esse GeoJSON com `shapely`/`geopandas` no lugar da lista
de coordenadas manual do exemplo.

## Como encontrar os nós de entrada/saída (start_node / end_node)

```python
import osmnx as ox
start_node = ox.distance.nearest_nodes(G_osm, X=lon_entrada, Y=lat_entrada)
end_node = ox.distance.nearest_nodes(G_osm, X=lon_saida, Y=lat_saida)
```

## Limitações e próximos passos

- O Mixed Chinese Postman Problem exato é NP-difícil; este solver usa uma
  heurística de fluxo de custo mínimo (ótima para grafos 100% dirigidos ou
  100% não-dirigidos, muito boa na prática para o caso misto real de malhas
  viárias). Para áreas muito grandes ou com topologia complexa, considere
  validar o resultado visualmente no QGIS.
- Assume que a malha dentro do polígono é conexa. Se houver ruas isoladas
  (sem conexão com o resto), o solver lança um erro — nesse caso, ajuste
  o polígono ou trate os componentes separadamente.
- `network_type="drive"` no OSMnx já filtra só vias para veículos e já
  aplica corretamente as tags `oneway` do OpenStreetMap.
- Para minimizar TEMPO em vez de DISTÂNCIA, troque o `weight` usado
  (ex.: calcule `travel_time = length / speed` por aresta e passe
  `weight="travel_time"` nas funções).

## Arquivos

- `mixed_cpp_solver.py` — biblioteca principal (todas as funções)
- `test_synthetic.py` — teste com grafo pequeno sintético (não depende de
  internet/OSM), útil para validar a lógica rapidamente
