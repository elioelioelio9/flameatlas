# Fire Lab — common tasks. Run from the repository root.
PY ?= python3
VENV = .venv
BIN = $(VENV)/bin

.PHONY: setup data api web test build serve fetch clean

setup:            ## create the Python venv and install front-end packages
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -r backend/requirements.txt
	cd frontend && npm install

data:             ## (re)build data/flameatlas.db from the PSI corpus
	cd backend && ../$(BIN)/python -m flameatlas.etl.build

api:              ## run the API with auto-reload on :8000
	cd backend && ../$(BIN)/uvicorn flameatlas.api.main:app --reload --port 8000

web:              ## run the front-end dev server on :5173 (proxies /api to :8000)
	cd frontend && npm run dev

test:             ## run the back-end test-suite
	cd backend && ../$(BIN)/python -m pytest -q

build:            ## production build of the front-end (served by the API at /)
	cd frontend && npm run build

serve: build      ## single-process production server on :8000
	cd backend && ../$(BIN)/uvicorn flameatlas.api.main:app --host 0.0.0.0 --port 8000

fetch:            ## re-download the PSI corpus from psi.nasa.gov (needs internet)
	$(BIN)/python scripts/fetch_psi_corpus.py

clean:
	rm -rf frontend/dist data/flameatlas.db backend/.pytest_cache
