// api/movies.js
import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    // 🔗 site alvo fixo (troque pelo site de onde quer puxar os filmes)
    const url = "https://www.visioncine-1.com/movies";

    const response = await axios.get(url, { timeout: 10000 });
    const html = response.data;
    const $ = cheerio.load(html);

    // 🎯 seletores fixos (ajuste de acordo com o site alvo)
    const itemSel = ".card";
    const titleSel = ".card-title";
    const yearSel = ".meta-year";
    const linkSel = "a";
    const thumbSel = "img";

    const movies = [];

    $(itemSel).each((i, el) => {
      const root = $(el);

      let t = root.find(titleSel).first().text().trim();
      let y = root.find(yearSel).first().text().trim();
      let l = root.find(linkSel).first().attr("href") || "";
      let th = root.find(thumbSel).first().attr("src") || "";

      if (t) {
        movies.push({
          title: t,
          year: y,
          link: new URL(l, url).toString(),
          thumb: new URL(th, url).toString()
        });
      }
    });

    return res.status(200).json(movies);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Erro ao raspar o site" });
  }
}