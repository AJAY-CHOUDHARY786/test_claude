import { Form } from "react-router";

/** The public "write a review" page body, shared by the emailed link (/r/...) and the shareable link (/c/...). */
export function ReviewFormPage({ productTitle, defaultName, errors }: { productTitle: string; defaultName: string; errors: Record<string, string> }) {
  return (
    <main className="page">
      <h1>How was your {productTitle}?</h1>
      <p className="lead">Your honest review helps other shoppers decide.</p>
      {errors.form && <p className="error" role="alert">{errors.form}</p>}
      <Form method="post" noValidate>
        <div className="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
        <fieldset>
          <legend>Your rating</legend>
          <div className="stars">
            {[5, 4, 3, 2, 1].map((n) => (<span key={n} style={{ display: "contents" }}><input type="radio" id={`s${n}`} name="rating" value={n} required /><label htmlFor={`s${n}`} title={`${n} star${n > 1 ? "s" : ""}`}><span aria-hidden="true">★</span><span className="hp">{n} stars</span></label></span>))}
          </div>
          {errors.rating && <p className="error" role="alert">{errors.rating}</p>}
        </fieldset>
        <label htmlFor="title">Headline (optional)</label>
        <input type="text" id="title" name="title" maxLength={120} />
        <label htmlFor="body">Your review</label>
        <textarea id="body" name="body" maxLength={5000} required aria-describedby={errors.body ? "body-err" : undefined} />
        {errors.body && <p className="error" id="body-err" role="alert">{errors.body}</p>}
        <label htmlFor="name">Name to show</label>
        <input type="text" id="name" name="name" maxLength={60} defaultValue={defaultName} required />
        {errors.name && <p className="error" role="alert">{errors.name}</p>}
        <button className="primary" type="submit">Submit review</button>
      </Form>
    </main>
  );
}

export const ThanksPage = () => <main className="page"><h1>Thank you</h1><p className="lead">Your review has been received. It may appear on the store after the shop owner has looked at it.</p></main>;
