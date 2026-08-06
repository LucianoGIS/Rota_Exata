"""
Teste da lógica central (balance_graph + solve_route) com um grafo
misto sintético pequeno, sem depender de download do OpenStreetMap.

Grafo: um quadrado de 4 nós (A,B,C,D) todo em mão dupla, mais uma
diagonal de mão única A->C. Isso simula um quarteirão com uma rua
de mão única cortando por dentro.
"""
import networkx as nx
from mixed_cpp_solver import balance_graph, solve_route, compute_imbalance

G = nx.MultiDiGraph()
for n in "ABCD":
    G.add_node(n, x=0, y=0)  # coords fake só p/ não quebrar (não usamos geojson aqui)

# mão dupla = duas arestas opostas
for u, v in [("A", "B"), ("B", "C"), ("C", "D"), ("D", "A")]:
    G.add_edge(u, v, length=10.0)
    G.add_edge(v, u, length=10.0)

# mão única: A -> C (diagonal), só nesse sentido
G.add_edge("A", "C", length=14.0)

print("Desbalanceamento antes:", compute_imbalance(G))

print("\n--- Caso 1: circuito fechado (start = end = A) ---")
route = solve_route(G, start_node="A", end_node="A")
print("Rota:", route)
print("Total de arestas na malha original:", G.number_of_edges())
print("Total de passos na rota:", len(route) - 1)
assert route[0] == "A" and route[-1] == "A"

print("\n--- Caso 2: caminho aberto (start = A, end = C) ---")
route2 = solve_route(G, start_node="A", end_node="C")
print("Rota:", route2)
print("Começa em A?", route2[0] == "A", " Termina em C?", route2[-1] == "C")
assert route2[0] == "A" and route2[-1] == "C"

print("\nTodos os testes passaram.")
