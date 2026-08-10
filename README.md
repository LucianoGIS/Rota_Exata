# Rota Exata - Otimização de Percurso para Coleta de Lixo

Aplicação web interativa para geração e otimização automática de rotas para veículos de serviço (ex.: caminhão de lixo) cobrindo **100% das ruas** dentro de um polígono delimitado (via KML), respeitando o sentido de tráfego e minimizando repetições.

---

## 📋 Pré-requisitos

Antes de iniciar em um novo computador, certifique-se de ter instalado:

- **Python 3.10 ou superior**: [https://www.python.org/downloads/](https://www.python.org/downloads/)
- **Node.js 18 ou superior** (com npm): [https://nodejs.org/](https://nodejs.org/)
- **Git**: [https://git-scm.com/](https://git-scm.com/)

---

## 🚀 Passo a Passo para Iniciar a Aplicação em Outro Computador

### 1. Clonar o Repositório

Abra o terminal ou prompt de comando e execute:

```bash
git clone https://github.com/LucianoGIS/Rota_Exata.git
cd Rota_Exata
```

---

### 2. Configurar e Instalar o Backend (Python / FastAPI)

No diretório raiz do projeto (`Rota_Exata`):

```bash
# (Opcional, mas recomendado) Criar e ativar ambiente virtual Python
python -m venv venv

# No Windows:
venv\Scripts\activate

# No Linux/macOS:
# source venv/bin/activate

# Instalar as dependências do backend Python
pip install fastapi uvicorn osmnx networkx shapely fpdf python-docx simplekml
```

---

### 3. Configurar e Instalar o Frontend (React / Vite)

Ainda no projeto, instale as dependências do frontend Node.js:

```bash
cd frontend
npm install
cd ..
```

---

### 4. Executar a Aplicação

Para utilizar a aplicação, você precisará manter **dois terminais abertos**:

#### Terminal 1: Iniciar o Backend (FastAPI / Uvicorn)
No diretório raiz do projeto (`Rota_Exata`), com o ambiente virtual ativado (se criou):

```bash
python -m uvicorn api:app --host 127.0.0.1 --port 8000
```
> O backend rodará em: `http://127.0.0.1:8000`

---

#### Terminal 2: Iniciar o Frontend (React / Vite)
Em uma nova janela de terminal, navegue até a pasta `frontend`:

```bash
cd Rota_Exata/frontend
npm run dev
```
> O frontend rodará em: `http://localhost:5173/`

---

## 💻 Como Utilizar a Aplicação

1. Abra o navegador em **`http://localhost:5173/`**.
2. Clique no botão **"Selecionar e Validar KML"** e escolha o arquivo `.kml` contendo a área da coleta.
3. Defina as opções desejadas:
   - **Passada Única em Ruas de Mão Dupla**: Evita que o caminhão passe no sentido oposto de uma rua residencial que já foi limpa.
   - **Ignorar Retornos / Travessias Desnecessários**: Garante que o caminhão não faça retornos de canteiro desnecessários em avenidas.
4. Clique em **"Gerar Rota Otimizada"**.
5. Navegue pela rota:
   - Use as **Teclas de Seta do Teclado (Esquerda ◄ / Direita ►)** para avançar ou voltar nó por nó no mapa com acompanhamento automático em tempo real.
   - Ajuste o **Espaçamento Numérico (15m, 25m, 50m, 100m)** para limpar a visualização dos números na tela.
   - Dê zoom no mapa até o nível **22 (Zoom Ultra Detalhado)**.
6. Baixe os relatórios oficiais completos com indicadores de manobra (ex.: *Vire à direita*, *Vire à esquerda*, *Siga em frente*, *Faça o retorno*) nos formatos **HTML**, **DOCX (Word)**, **PDF** ou **GeoJSON / KML**.

---

## 🛠️ Estrutura do Projeto

- `api.py` — Servidor FastAPI (Rotas de cálculo e exportação de PDF, DOCX, HTML, KML).
- `mixed_cpp_solver.py` — Algoritmo solucionador Euleriano Misto (download do OSM, grafo de trabalho e balanceador de fluxo).
- `frontend/` — Interface web React + Leaflet + Vite.
- `test_synthetic.py` — Teste unitário sintético offline da lógica do solucionador.
