
//armazena todos os diagramas carregados nessa lista
let diagrams = [];

//funcao p renderizar a tabela
function renderizarTabela(lista){
   //pega a tabela no html
   const tbody = document.getElementById("corpoTabela"); 

  //opcao pra caso nao encontre nenhum item
   tbody.innerHTML = ""
   if (lista.length == 0){
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="items">
                    Nenhum arquivo encontrado.
                </td>
            </tr>
        `;
        return;
   }

   //for para renderizar os itens encontrados
   lista.forEach(diagram => {
        //cria o elemento de dentro da tabela (a linha)
        const line = document.createElement("tr");


        //cria oq mostra na linha (o nome, a datal o status e o botao para editar o diagrama)
        line.innerHTML = `
            <td class="items">${diagram.nome}</td>
            <td class="items">${diagram.atualizado_em}</td>
            <td class="items">${diagram.status}</td>
            <td>
                <button onclick="editarDiagrama('${diagram.id}')" class="btnEditar">
                    <i class="fa-solid fa-pencil"></i>
                    Editar diagrama
                </button>
            </td>
        `;

        //adiciona a linha ao corpo
        tbody.appendChild(line);
    });
}

function renderizarPaginacao(total) {

    const paginacao = document.getElementById("paginacao");

    paginacao.innerHTML = "";

    //pra arredondar o valor das paginas pra cima, caso o total de itens nao seja divisivel pelo limite
    const totalPaginas = Math.ceil(total / limite);

    for (let i = 1; i <= totalPaginas; i++) {


        //cria o botao da pagina
        const botao = document.createElement("button");

        //adiciona o numero da pagina no botao
        botao.textContent = i;

        //desabilita o botao da pagina atual
        if (i === paginaAtual) {
            botao.disabled = true;
        }

        //adiciona o evento de click no botao, que muda a pagina atual e recarrega a lista
        botao.addEventListener("click", function () {
            paginaAtual = i;
            carregarLista();
        });

        paginacao.appendChild(botao);
    }
}

//variaveis para controlar a pagina atual e o limite de itens por pagina
let paginaAtual = 1;
const limite = 10;

async function carregarLista() {
    //pega o corpo da tabela
    const tbody = document.getElementById("corpoTabela");

    try {
        //faz a requisicao para o backend, passando a pagina atual e o limite de itens por pagina
        const response = await fetch(
            `/api/diagrama?page=${paginaAtual}&limit=${limite}`
        );

        //verifica se a resposta foi ok, caso nao seja, lança um erro
        const dados = await response.json();

        console.log(dados); // pra ver os dados

        //armazena os diagramas na variavel global
        diagrams = dados.diagramas;

        //renderiza a tabela com os diagramas carregados
        renderizarTabela(diagrams);

        //renderiza a paginacao com o total de itens retornados pelo backend
        renderizarPaginacao(dados.total);

    } catch (erro) {
        console.error(erro);

        //mostra uma mensagem de erro na tabela caso a requisicao falhe
        tbody.innerHTML = `
            <tr>
                <td colspan="4">Erro ao carregar a lista.</td>
            </tr>
        `;
    }
}

function editarDiagrama(id) {
    //redireciona para a página de edição passando o ID na URL
    window.location.href = `index.html?id=${id}`;
}


campoBusca = document.getElementById('searchFile')
//pega o id do input (searchFile)
campoBusca.addEventListener("input", function () {
    //pega o texto digitado, transforma em minusculo e tira os espacos do comeco e fim
    const texto = this.value.toLowerCase().trim();

    //filtra os diagramas por nome, transformando tbm em minusculo
    const filtrados = diagrams.filter(diagram =>
        diagram.nome.toLowerCase().includes(texto)
    );

    //renderiza a tabela
    renderizarTabela(filtrados);
});

carregarLista();