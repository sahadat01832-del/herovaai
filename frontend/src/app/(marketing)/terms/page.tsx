import type { Metadata } from 'next'
import { LegalShell, LegalList, LegalNote, LegalSection } from '@/components/marketing/LegalShell'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `Terms of Service — ${SITE_NAME}`,
    description: `The rules for using ${SITE_NAME}: accounts, acceptable use, plans, availability and liability.`,
    alternates: { canonical: '/terms' },
    openGraph: { title: `Terms of Service — ${SITE_NAME}`, description: SITE_TAGLINE, type: 'article' },
  }
}

const UPDATED = '9 October 2026'

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      updated={UPDATED}
      intro={
        <p>
          These terms are between you and the operator of this {SITE_NAME} deployment. By creating
          an account or using the service, you accept them. If you are agreeing on behalf of a
          business, you confirm you may do so.
        </p>
      }
    >
      <LegalNote>
        The short version: use the assistant to serve your own customers honestly, keep your
        account secure, review what it sends, and remember that AI answers are best-effort — you
        remain responsible for what your business says to a customer.
      </LegalNote>

      <LegalSection title="1. The service">
        <p>
          {SITE_NAME} connects to a WhatsApp number you control and answers your customers'
          questions using your business information, your instructions and an AI model you choose
          in the app. It also keeps a memory of your business so answers stay consistent, and shows
          you the conversations so you can step in.
        </p>
        <p>
          AI-generated answers can be wrong or incomplete. Review the assistant's behaviour when you
          set it up, keep an eye on your conversations, and do not rely on it for legal, medical,
          financial or safety-critical advice.
        </p>
      </LegalSection>

      <LegalSection title="2. Your account">
        <LegalList>
          <li>Give accurate details and keep them up to date.</li>
          <li>Keep your password and any paired WhatsApp session secure; you are responsible for activity under your account.</li>
          <li>One account per business, unless the operator agrees otherwise.</li>
          <li>Tell the operator promptly if you believe your account has been compromised.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="3. Acceptable use">
        <LegalList>
          <li>No spam, bulk unsolicited messaging, or anything that breaks WhatsApp's own terms for your number.</li>
          <li>No unlawful, deceptive, harassing or infringing content, and no using the assistant to mislead your customers about prices, offers or what your business will do.</li>
          <li>No attempts to break, overload, reverse-engineer or gain unauthorised access to the service, or to use it to attack anyone else.</li>
          <li>No reselling or white-labelling the service without the operator's written agreement.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. Your content">
        <p>
          Your business data, instructions and customer conversations remain yours. You give the
          operator permission to store and process them only as far as running the service for you
          requires — including sending the text of a message to the AI provider of the model you
          selected. You confirm you have the right to share that content, including any customer
          conversation you connect to the service.
        </p>
      </LegalSection>

      <LegalSection title="5. Plans and fair use">
        <p>
          The app lists the plan tiers it offers and the limits that apply to each, and the
          Subscription page shows which one your account is on. No card details are collected by
          this site. If paid plans are enabled for this deployment, the price and payment terms will
          be shown before you subscribe, and cancelling will stop future charges.
        </p>
      </LegalSection>

      <LegalSection title="6. Availability and changes">
        <p>
          The service is provided on a best-effort basis. It depends on other systems — the AI
          provider, WhatsApp, the hosting and tunnel providers, and your own internet connection —
          so interruptions, delays and quota limits can happen. Features may change or be withdrawn
          as the product develops.
        </p>
      </LegalSection>

      <LegalSection title="7. Suspension and termination">
        <p>
          You can stop using the service at any time; ask the operator to close your account and
          delete its data. The operator may suspend or end access if these terms are broken, if the
          service is being used unlawfully, or if running it for you is no longer practical — with
          reasonable notice unless the problem is urgent.
        </p>
      </LegalSection>

      <LegalSection title="8. Liability">
        <p>
          To the extent the law allows, the operator is not liable for lost profits, lost business,
          lost data or indirect and consequential losses, and total liability for any claim is
          limited to the amount you paid for the service in the twelve months before the claim — or
          to nothing, on a free plan. Nothing here excludes liability that cannot lawfully be
          excluded.
        </p>
      </LegalSection>

      <LegalSection title="9. Governing law">
        <p>
          These terms are governed by the laws of Bangladesh, and disputes will be handled by the
          courts there, unless the operator's published details say otherwise for your deployment.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes to these terms">
        <p>
          When these terms change, the date at the top of this page changes with it, and material
          changes are announced inside the app before they take effect. Continuing to use the
          service after that means you accept the updated terms.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
