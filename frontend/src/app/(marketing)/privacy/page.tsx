import type { Metadata } from 'next'
import { LegalShell, LegalList, LegalNote, LegalSection } from '@/components/marketing/LegalShell'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Privacy Policy — ${SITE_NAME}`,
    description:
      `What ${SITE_NAME} stores, why it stores it, where it is processed and how to control or delete it.`,
    alternates: { canonical: '/privacy' },
    openGraph: { title: `Privacy Policy — ${SITE_NAME}`, description: SITE_TAGLINE, type: 'article' },
  }
}

const UPDATED = '9 October 2026'

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      updated={UPDATED}
      intro={
        <p>
          {SITE_NAME} is a self-hosted assistant for WhatsApp customer conversations. This page
          explains what <em>this deployment</em> collects, why it collects it, where it is
          processed, and how you can control or remove it. “We” and “the operator” mean the
          business running this deployment for you.
        </p>
      }
    >
      <LegalNote>
        The short version: your business data lives in this deployment's own database on the
        operator's server, it is never sold and there are no advertising or analytics trackers on
        this site. When you pick a cloud model, the text needed for a reply is sent to that AI
        provider; when you pick a local model, it does not leave this machine.
      </LegalNote>

      <LegalSection title="What we collect">
        <LegalList>
          <li>
            <strong className="font-medium text-dark-200">Account details.</strong> Your name,
            email address, optional phone number, and a profile picture if your sign-in provider
            supplies one. Passwords are stored only as one-way hashes — never as readable text.
          </li>
          <li>
            <strong className="font-medium text-dark-200">What you teach the assistant.</strong>{' '}
            Your business profile (name, industry, description, website, contact email), your
            catalog and prices, the instructions and tone you set, and the memories the assistant
            builds from your conversations so it can answer the way you would.
          </li>
          <li>
            <strong className="font-medium text-dark-200">Customer conversations.</strong> When you
            pair a WhatsApp number, the messages exchanged with your customers are stored: the
            text, the customer's phone number, whether each message was incoming or outgoing, and
            timestamps. This is what lets the assistant answer and lets you review what was said.
          </li>
          <li>
            <strong className="font-medium text-dark-200">Security records.</strong> Standard
            request metadata — IP address, browser user agent and timestamps — kept to protect the
            service and diagnose faults.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Why we process it">
        <LegalList>
          <li>To provide the service: reply to your customers, show you your conversations, and keep the assistant's memory of your business.</li>
          <li>To keep accounts and the deployment secure, and to detect abuse.</li>
          <li>To support you when something goes wrong, and to meet legal obligations.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Where it is processed, and who else sees it">
        <LegalList>
          <li>
            <strong className="font-medium text-dark-200">This deployment.</strong> Data is stored
            in the operator's own database on the server that runs this site.
          </li>
          <li>
            <strong className="font-medium text-dark-200">AI providers.</strong> Replies are written
            by an AI model you choose. A <em>local</em> model runs on the same machine and keeps the
            text there. A <em>cloud</em> model — for example Groq or Google Gemini, as listed in
            the model picker — receives the message text needed to produce the reply, under that
            provider's own terms.
          </li>
          <li>
            <strong className="font-medium text-dark-200">Google (optional).</strong> If you sign in
            with Google, Google authenticates you and shares your name, email address and picture.
            You can also register with an email address instead.
          </li>
          <li>
            <strong className="font-medium text-dark-200">WhatsApp.</strong> Messages travel between
            you and your customer through WhatsApp as they normally would; the assistant works from
            your own paired WhatsApp session.
          </li>
          <li>
            <strong className="font-medium text-dark-200">Hosting and delivery.</strong> Public
            traffic is proxied through the hosting or tunnel provider that publishes this site, and
            that provider processes ordinary request metadata such as IP addresses to deliver it.
          </li>
          <li>
            <strong className="font-medium text-dark-200">Administrators.</strong> The operator and
            any admin account they create can see accounts, conversations and memories in the admin
            area. That access is how the service is run and supported for you.
          </li>
        </LegalList>
        <p>We do not sell your data, and we do not use it for advertising.</p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <LegalList>
          <li>Review, edit and delete memories and conversations from the dashboard at any time.</li>
          <li>Pause or stop automatic replies, and disconnect the paired WhatsApp number whenever you want.</li>
          <li>Ask the operator to delete your account and its business data; the stored conversations for your session are removed with it.</li>
          <li>Ask what we hold about you and ask for a copy.</li>
        </LegalList>
        <p>
          If you are a <em>customer</em> of a business that uses {SITE_NAME}, your conversation is
          controlled by that business — please contact them. We process it on their instruction.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          Account data, business memories and conversations are kept while your account is active,
          and are deleted when you delete the account or ask the operator to. Security records
          rotate automatically after a short period.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and local storage">
        <p>
          This site sets no advertising or analytics cookies. Signing in stores an access token in
          your browser's own storage so the app can recognise you, and the optional Google sign-in
          handshake uses a short-lived session cookie on the server. Google may set its own cookies
          during sign-in, under Google's policies.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Passwords are stored as bcrypt hashes, sign-in sessions are issued as signed tokens,
          administrative access is limited to operator accounts, and provider keys live in
          server-side configuration rather than in the browser. No system is perfectly secure: if
          you believe your account or data has been misused, tell the operator straight away.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          {SITE_NAME} is a tool for businesses and is not intended for anyone under 18, and we do
          not knowingly collect data from children.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          When this policy changes, the date at the top of this page changes with it. Material
          changes are announced inside the app before they take effect.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          To exercise any of the choices above, contact the operator of this deployment — the
          business that gave you access to it, or the address in your welcome message. If you are
          the operator, you can reach your own support route from the dashboard.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
