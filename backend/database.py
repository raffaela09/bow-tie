import sqlite3
import uuid
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "bowtie_risks.db"


def obter_conexao():
    conexao = sqlite3.connect(DB_PATH)
    conexao.row_factory = sqlite3.Row
    return conexao


def inicializar_banco():
    conexao = obter_conexao()
    # id é TEXT (não INTEGER AUTOINCREMENT) porque é gerado no cliente
    # (crypto.randomUUID()) assim que um diagrama novo é aberto — isso permite
    # que a sincronização automática no fechamento da aba (sendBeacon, que não
    # lê resposta do servidor) sempre faça UPSERT sobre um id já conhecido, em
    # vez de criar uma linha nova a cada fechamento sem salvamento explícito.
    conexao.execute(
        """
        CREATE TABLE IF NOT EXISTS diagramas (
            id TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            dados_json TEXT NOT NULL,
            atualizado_em TIMESTAMP NOT NULL DEFAULT (datetime('now','localtime'))
        )
        """
    )
    conexao.commit()
    conexao.close()


def salvar_diagrama(id_diagrama, nome, dados_json):
    """Insere um novo diagrama ou atualiza um existente (UPSERT por id)."""
    conexao = obter_conexao()
    try:
        id_resultante = id_diagrama or str(uuid.uuid4())
        conexao.execute(
            """
            INSERT INTO diagramas (id, nome, dados_json, atualizado_em)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                nome = excluded.nome,
                dados_json = excluded.dados_json,
                atualizado_em = datetime('now', 'localtime')
            """,
            (id_resultante, nome, dados_json),
        )
        conexao.commit()
        return id_resultante
    finally:
        conexao.close()


def obter_diagrama(id_diagrama):
    conexao = obter_conexao()
    try:
        linha = conexao.execute(
            "SELECT id, nome, dados_json, atualizado_em FROM diagramas WHERE id = ?",
            (id_diagrama,),
        ).fetchone()
        return dict(linha) if linha else None
    finally:
        conexao.close()


def listar_diagramas(pagina=1, limite=5):
    conexao = obter_conexao()

    try:
        offset = (pagina - 1) * limite

        linhas = conexao.execute(
            """
            SELECT id, nome, atualizado_em
            FROM diagramas
            ORDER BY atualizado_em DESC
            LIMIT ? OFFSET ?
            """,
            (limite, offset)
        ).fetchall()

        total = conexao.execute(
            "SELECT COUNT(*) FROM diagramas"
        ).fetchone()[0]

        return {
            "diagramas": [dict(linha) for linha in linhas],
            "total": total
        }

    finally:
        conexao.close()