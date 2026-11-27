export const metadata = { title: "Política de Privacidade · Post Lead" };

const COMPANY = "SNOW TECH DESENVOLVIMENTO DE SOFTWARES LTDA";
const CONTACT_EMAIL = "techsnow99@gmail.com";
const UPDATED_AT = "27 de novembro de 2026";

export default function PrivacyPage() {
  return (
    <main className="legal">
      <article className="card legal-card">
        <h1>Política de Privacidade do Post Lead</h1>
        <p className="muted">Última atualização: {UPDATED_AT}</p>

        <h2>1. Quem somos</h2>
        <p>
          O Post Lead é uma ferramenta de atendimento de leads pelo WhatsApp, operada por {COMPANY} (“nós”). Ela é
          usada por empresas clientes (“Clientes”) para responder, organizar e acompanhar as conversas que chegam
          no número de WhatsApp de cada Cliente.
        </p>
        <p>
          Em relação às conversas dos leads, o Cliente é o controlador dos dados e nós atuamos como operador,
          tratando os dados em nome dele e segundo as instruções dele, conforme a Lei Geral de Proteção de Dados
          (Lei 13.709/2018).
        </p>

        <h2>2. Dados que tratamos</h2>
        <ul>
          <li>
            <strong>Leads (pessoas que escrevem para o Cliente no WhatsApp):</strong> nome do perfil, número de
            telefone, conteúdo das mensagens trocadas com o Cliente, data e hora das mensagens e, quando a conversa
            vem de um anúncio, a identificação do anúncio de origem.
          </li>
          <li>
            <strong>Histórico anterior à ativação:</strong> quando o Cliente autoriza, a Meta compartilha uma vez o
            histórico dos últimos 180 dias. Desse histórico guardamos apenas data, hora e direção de cada mensagem
            (enviada ou recebida). O texto é usado uma única vez para sugerir perguntas frequentes ao Cliente e
            depois é apagado.
          </li>
          <li>
            <strong>Equipe do Cliente:</strong> nome e número de WhatsApp dos vendedores, usados para avisá-los de
            novos leads e registrar o resultado de cada atendimento (por exemplo, venda ganha e valor da venda).
          </li>
          <li>
            <strong>Usuários do painel:</strong> e-mail usado para entrar no painel administrativo.
          </li>
        </ul>

        <h2>3. Para que usamos os dados</h2>
        <ul>
          <li>Responder automaticamente aos leads e fazer o pré-atendimento configurado pelo Cliente.</li>
          <li>Encaminhar o lead ao vendedor responsável e enviar lembretes e acompanhamentos.</li>
          <li>Gerar relatórios de atendimento e vendas para o Cliente.</li>
          <li>Manter a segurança e o funcionamento da ferramenta.</li>
        </ul>
        <p>Não vendemos dados pessoais e não os usamos para publicidade.</p>

        <h2>4. Com quem compartilhamos</h2>
        <p>Usamos fornecedores que processam dados apenas para prestar o serviço:</p>
        <ul>
          <li>Meta Platforms (WhatsApp Business Platform), para enviar e receber mensagens.</li>
          <li>Anthropic, para gerar as respostas do pré-atendimento com inteligência artificial.</li>
          <li>Supabase (banco de dados, hospedado no Brasil), Vercel e Railway, para hospedagem da ferramenta.</li>
        </ul>
        <p>
          Alguns desses fornecedores podem tratar dados fora do Brasil, com as salvaguardas previstas na LGPD.
        </p>

        <h2>5. Por quanto tempo guardamos</h2>
        <p>
          Guardamos os dados enquanto o Cliente usar o Post Lead. Quando o contrato termina, ou quando o Cliente
          pede, os dados dele são excluídos, salvo o que a lei exigir que seja mantido.
        </p>

        <h2>6. Seus direitos e exclusão de dados</h2>
        <p>
          Você pode pedir acesso, correção ou exclusão dos seus dados, ou informações sobre o tratamento. Se você é
          lead de um Cliente, também pode falar diretamente com a empresa com quem conversou. Para pedir a exclusão
          dos seus dados, escreva para <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> informando o número
          de telefone usado no WhatsApp. Respondemos em até 15 dias.
        </p>

        <h2>7. Segurança</h2>
        <p>
          Os dados ficam em bancos com controle de acesso por Cliente, as conexões são criptografadas e o acesso ao
          painel exige login.
        </p>

        <h2>8. Contato</h2>
        <p>
          {COMPANY} · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </article>
    </main>
  );
}
