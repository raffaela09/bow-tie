import json
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import FastAPI, HTTPException, Query

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from database import inicializar_banco, listar_diagramas, obter_diagrama, salvar_diagrama, atualizar_status_diagrama

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

app = FastAPI(title="BowTie Diagrama API", version="1.0.0")

inicializar_banco()

app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


class DiagramaPayload(BaseModel):
    id: Optional[str] = None
    nome: str = "Diagrama sem título"
    dados: Dict[str, Any]
    status: str = "em_progresso"


class StatusPayload(BaseModel):
    status: str


@app.get("/")
def servir_frontend():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.post("/api/diagrama/salvar")
def salvar(payload: DiagramaPayload):
    dados_json = json.dumps(payload.dados, ensure_ascii=False)
    id_resultante = salvar_diagrama(payload.id, payload.nome, dados_json, payload.status)
    return {"id": id_resultante, "status": payload.status}


@app.patch("/api/diagrama/{id_diagrama}/status")
def alterar_status(id_diagrama: str, payload: StatusPayload):
    if payload.status not in ("em_progresso", "concluido"):
        raise HTTPException(status_code=400, detail="Status inválido")
    sucesso = atualizar_status_diagrama(id_diagrama, payload.status)
    if not sucesso:
        raise HTTPException(status_code=404, detail="Diagrama não encontrado")
    return {"id": id_diagrama, "status": payload.status}


@app.get("/api/diagrama/{id_diagrama}")
def obter(id_diagrama: str):
    registro = obter_diagrama(id_diagrama)
    if not registro:
        raise HTTPException(status_code=404, detail="Diagrama não encontrado")
    return {
        "id": registro["id"],
        "nome": registro["nome"],
        "dados": json.loads(registro["dados_json"]),
        "status": registro["status"],
        "atualizado_em": registro["atualizado_em"],
    }

@app.get("/api/diagrama")
def listar(
    page: int = Query(1),
    limit: int = Query(5)
):
    return listar_diagramas(page, limit)
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")