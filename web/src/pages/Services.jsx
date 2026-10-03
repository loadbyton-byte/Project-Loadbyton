import React from 'react';
import { Link } from 'react-router-dom';
import { SitePage, SubHero, SubSection, SubCta, PHOTOS } from '../components/marketing/SubKit.jsx';

const services = [
  ['Container transport and drayage', 'Request a truck movement between a port, container yard and delivery location. Include 20ft or 40ft container size, loaded or empty status, cargo weight, pickup reference and delivery slot. For a Jebel Ali or Khalifa Port movement, confirm terminal access and collection requirements with the selected transporter.'],
  ['Full truckload road freight', 'For a dedicated truck, specify pickup and delivery addresses, cargo dimensions, total weight and loading method. Dubai, Abu Dhabi, Sharjah and Fujairah routes need a clear collection window and receiving contact before dispatch.'],
  ['Flatbed and lowbed transport', 'For construction materials, machinery or industrial cargo, provide dimensions, axle or load constraints and loading equipment. Ask the transporter to confirm suitable equipment, route restrictions and any permits before awarding the movement.'],
  ['Refrigerated freight requirements', 'For temperature-sensitive cargo, state the required temperature range, packaging, loading duration and delivery window. Confirm vehicle suitability, temperature records and handling arrangements directly with the transporter.'],
  ['Multi-truck transport requirements', 'For volume inquiries or recurring lanes, describe the number of trucks, equipment mix, schedule and expected cargo volumes. Compare operational capacity and availability alongside quotation price.'],
];
const questions = [
  ['What is Loadbyton?', 'Loadbyton is a UAE road freight and container drayage marketplace. Shippers post transport requirements, transporters submit bids, and the job workspace keeps messages, documents and delivery records together.'],
  ['How do I request a freight quotation in the UAE?', 'Register as a shipper, enter pickup and delivery details, choose suitable equipment, and describe cargo and timing. Review transporter responses and confirm availability and operational requirements before awarding a job.'],
  ['How much does container transport cost?', 'A quotation depends on route, truck type, container size, cargo weight, pickup slot, waiting time and empty return requirements. Loadbyton lets you compare bids for your specific load; a generic advertised rate may not include every charge.'],
  ['Is Loadbyton a trucking company?', 'Loadbyton is a marketplace connecting shippers with transporters. Confirm vehicle availability, terminal access, handling obligations and any special requirements with the transporter for each job.'],
  ['What should I check before booking a truck?', 'Check equipment suitability, loading and unloading arrangements, collection references, delivery access, waiting charges and required documents. Agree responsibility for permits and special cargo handling before dispatch.'],
  ['Can I find freight jobs as a transporter?', 'Register with the transporter role, complete the applicable account verification steps, review available loads and submit a bid for requirements that fit your equipment and operating capacity.'],
];
export default function Services() {
  return <SitePage>
    <SubHero photo={PHOTOS.roadFreight} kicker="UAE FREIGHT SERVICES" title="The right requirement. The right truck." lede="Plan UAE road freight and container transport with clear cargo details, comparable transporter quotations and a shared shipment record." />
    <SubSection tone="white" no="01 / Transport requirements" title="Choose equipment around the cargo.">
      <p>Loadbyton connects shippers and transporters. Availability and suitability are confirmed for each requirement; listing a truck type does not guarantee capacity on a particular route or date.</p>
      <div className="sub-posts">{services.map(([title, body]) => <article className="sub-post" key={title}><div><h3>{title}</h3><p>{body}</p></div></article>)}</div>
    </SubSection>
    <SubSection no="02 / Booking checklist" title="Give transporters enough detail to quote.">
      <ol><li>Pickup and delivery addresses, including port or warehouse access.</li><li>Cargo weight, dimensions, packaging and required truck type.</li><li>Collection date, loading slot and delivery deadline.</li><li>Loading equipment, unloading arrangements and site restrictions.</li><li>Container return location, waiting terms and supporting references where applicable.</li></ol>
      <p><Link to="/for-shippers">See the shipper workflow</Link> · <Link to="/for-transporters">Find UAE freight jobs</Link> · <Link to="/pricing">Review platform pricing</Link> · <Link to="/industries">Explore industry requirements</Link></p>
    </SubSection>
    <SubSection tone="white" no="03 / Freight questions" title="Answers before you book.">
      {questions.map(([q,a]) => <article key={q}><h3>{q}</h3><p>{a}</p></article>)}
    </SubSection>
    <SubCta kicker="Start a requirement" title="Put your next movement in one workspace." primary={['Register as a shipper', '/register']} secondary={['Explore features', '/features']} />
  </SitePage>;
}
