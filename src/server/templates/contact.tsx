import { Layout } from "@server/components/layouts";

export const Contact = () => (
  <Layout title="Contact" name="contact">
    <h1>Contact Page</h1>

    <section className="card">
      <p>
        HTML forms are awesome. Submit with the amazing built in{" "}
        <code>action</code> attribute. Or, you can intercept the submit event in
        JS just for fun like we do here.
      </p>
      <p>
        We've also got some native custom validation for the name field which is
        nice.
      </p>
      <form>
        <input
          type="text"
          placeholder="Your name"
          required
          name="name"
          minLength={3}
        />
        <button type="submit">Send</button>
      </form>
    </section>
  </Layout>
);
