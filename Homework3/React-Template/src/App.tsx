

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import "./style.css";
import { hexbin } from "d3-hexbin";


type SpotifyRowArtist = {
  track_popularity: number;
  artist_name: string;
  artist_popularity: number;
  artist_followers: number;
  artist_genres: string;
  track_name: string;
};


type SpotifyRowTrack = {
  track_name: string;
  track_popularity: number;
  track_duration_ms: number;
  artist_name: string;
  artist_popularity: number;
  artist_followers: number;
  artist_genres: string;
};

export default function App() {
const [data, setData] = useState<SpotifyRowArtist[]>([]);
const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
const [artistData, setArtistData] = useState<SpotifyRowArtist[]>([]);
const [trackData, setTrackData] = useState<SpotifyRowTrack[]>([]);
const [maxBinCount, setMaxBinCount] = useState<number>(0);


const [selectedNode, setSelectedNode] = useState<string | null>(null); //for view 2 
const [selectedType, setSelectedType] = useState<"artist" | "genre" | null>(null);


  const view1Ref = useRef<SVGSVGElement | null>(null);
  const view2Ref = useRef<SVGSVGElement | null>(null);
  const view3Ref = useRef<SVGSVGElement | null>(null);

  /* =======================
     LOAD DATA
     ======================= */
useEffect(() => {
  d3.csv("/data/spotify_data_clean.csv", d3.autoType).then(d => { //ArtistData
    setArtistData(d as SpotifyRowArtist[]);
  });
}, []);

useEffect(() => {
  d3.csv("/data/spotify.csv", d3.autoType).then(d => { //TrackData
    setTrackData(d as SpotifyRowTrack[]);
  });
}, []);




  /* =========================================================
     VIEW 1
     ========================================================= */
useEffect(() => {
  if (!trackData.length || !view1Ref.current) return;

  const svg = d3.select(view1Ref.current);
  svg.selectAll("*").remove();

  const width = 900;
  const height = 260;
  const margin = { top: 40, right: 30, bottom: 50, left: 60 };



  svg.attr("viewBox", `0 0 ${width} ${height}`);

  let highlightArtist: string | null = null;

  if (selectedNode && selectedType === "artist") {
    highlightArtist = selectedNode;
  }

  let topSongs: SpotifyRowTrack[] = [];

  if (highlightArtist) {
    topSongs = trackData
      .filter(d => d.artist_name === highlightArtist)
      .sort((a, b) =>
        d3.descending(a.track_popularity, b.track_popularity)
      )
      .slice(0, 10);
  }

  d3.selectAll(".hex-tooltip").remove();

  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "hex-tooltip")
    .style("position", "absolute")
    .style("background", "white")
    .style("padding", "8px")
    .style("border", "1px solid gray")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("pointer-events", "none")
    .style("opacity", 0);

  const x = d3.scaleLinear()
  .domain([0, 7])
  .range([margin.left, width - margin.right])
  .clamp(true);

const y = d3.scaleLinear()
  .domain([0, 100])
  .range([height - margin.bottom, margin.top]);

const points = trackData.map((d, i) => ({
  x: x(d.track_duration_ms / 60000),
  y: y(d.track_popularity),
  artist: d.artist_name,
  index: i
}));

const hex = hexbin<any>()
  .x(d => d.x)
  .y(d => d.y)
  .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]])
  .radius(8);

const bins = hex(points);

const maxCount = d3.max(bins, d => d.length) || 0;
setMaxBinCount(maxCount);

let colorMaxCount = maxCount;
if (highlightArtist) {
  colorMaxCount = d3.max(bins, d => {
    const artistPoints = d.filter(p => p.artist === highlightArtist);
    return artistPoints.length;
  }) || 1;
}

const color = d3.scaleSequential(t => d3.interpolateBlues(0.3 + t * 0.7))
  .domain([0, colorMaxCount])
  .clamp(true);

  const hexGroup = svg.append("g");

hexGroup.selectAll("path")
    .data(bins)
    .enter()
    .append("path")
    .attr("d", hex.hexagon())
    .attr("transform", d => `translate(${d.x},${d.y})`)
    .attr("stroke", "white")
    .attr("stroke-width", 0.3)
    .attr("fill", d => {
      if (!highlightArtist) {
        return color(d.length);
      }

      const artistPoints = d.filter(p => p.artist === highlightArtist);

      if (artistPoints.length > 0) {
        return color(artistPoints.length);
      } else {
        return "#f0f0f0";
      }
    })
.on("mouseover", function (event, d) {
  let songsInBin = d.map(p => trackData[p.index]);

  if (highlightArtist) {
    songsInBin = songsInBin.filter(
      s => s.artist_name === highlightArtist
    );
  }

  if (!songsInBin.length) return;

  const totalCount = songsInBin.length;
  const displaySongs = songsInBin.slice(0, 10);
  const hasMore = totalCount > 10;

  tooltip
    .style("opacity", 1)
    .html(`
      <strong>Songs in this bin (${totalCount}):</strong><br/>
      ${displaySongs.map(s => s.track_name).join("<br/>")}
      ${hasMore ? `<br/><strong>(${totalCount - 10} more...)</strong>` : ""}
    `)
    .style("left", event.pageX + 10 + "px")
    .style("top", event.pageY - 20 + "px");
})

    .on("mouseout", () => tooltip.style("opacity", 0))
    .attr("opacity", 0)
    .transition()
    .duration(800)
    .attr("opacity", d => {
      if (!highlightArtist) return 1;

      const hasArtist = d.some(p => p.artist === highlightArtist);
      return hasArtist ? 1 : 0.2;
    });

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(6));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("class", "title")
    .text("Track Duration vs Popularity");

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", height - 10)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .text("Track Duration (minutes)");

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", 15)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .text("Track Popularity");

}, [trackData, selectedNode, selectedType]);

// ==========================
// VIEW 2
// ==========================
useEffect(() => {
  if (!artistData.length || !view2Ref.current) return;

  const svg = d3.select(view2Ref.current);
  svg.selectAll("*").remove();

  const width = 500;
  const height = 340;
  const margin = { top: 60, right: 40, bottom: 100, left: 220 };

  let displayData: [string, number][] = [];
  let title = "Top 10 Artists Overall";

  if (selectedNode && selectedType === "artist") {
    const topTracks = artistData
      .filter(d => d.artist_name === selectedNode)
      .filter((d, i, arr) =>
        arr.findIndex(x => x.track_name === d.track_name) === i
      )
      .sort((a, b) =>
        d3.descending(a.track_popularity, b.track_popularity)
      )
      .slice(0, 10);

    displayData = topTracks.map(d => [
      d.track_name,
      d.track_popularity
    ]);

    title = `Top 10 Songs – ${selectedNode}`;
  }

  else if (selectedNode && selectedType === "genre") {
     const genreFiltered = artistData.filter(d => {
  if (!d.artist_genres) return false;

  const genres = String(d.artist_genres)
    .split(",")
    .map(g => g.trim().toLowerCase());

  return genres.includes(selectedNode!.toLowerCase());
});


    displayData = d3.rollups(
      genreFiltered,
      v => d3.mean(v, d => d.artist_followers)!,
      d => d.artist_name
    )
      .sort((a, b) => d3.descending(a[1], b[1]))
      .slice(0, 10);

    title = `Top 10 Artists – ${selectedNode}`;
  }

  else {
    displayData = d3.rollups(
      artistData,
      v => d3.mean(v, d => d.artist_followers)!,
      d => d.artist_name
    )
      .sort((a, b) => d3.descending(a[1], b[1]))
      .slice(0, 10);

    title = "Top 10 Artists Overall";
  }

  if (!displayData.length) {
    svg.append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .attr("font-size", 13)
      .text("No matching data.");
    return;
  }

  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const x = d3.scaleLinear()
    .domain([0, d3.max(displayData, d => d[1])!])
    .range([margin.left, width - margin.right]);

  const y = d3.scaleBand()
    .domain(displayData.map(d => d[0]))
    .range([margin.top, height - margin.bottom])
    .padding(0.25);

svg.append("g")
  .selectAll("rect")
  .data(displayData)
  .enter()
  .append("rect")
  .attr("x", margin.left)
  .attr("y", d => y(d[0])!)
  .attr("width", 0)
  .attr("height", y.bandwidth())
  .attr("fill", "#74d1cc")
  .style("cursor", "pointer")
  .on("click", (_, d) => {
    if (selectedType === "genre" || selectedType === null) {
      setSelectedNode(d[0]);
      setSelectedType("artist");
    }
  })
  .transition()
  .duration(700)
  .attr("width", d => x(d[1]) - margin.left);

const formatNumber = (num: number) => {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
};

svg.append("g")
  .selectAll("text.value")
  .data(displayData)
  .enter()
  .append("text")
  .attr("class", "value")
  .attr("x", d => x(d[1]) + 6)
  .attr("y", d => y(d[0])! + y.bandwidth() / 2)
  .attr("dy", "0.35em")
  .attr("font-size", 11)
  .text(d => formatNumber(d[1]));

  const xAxis = d3.axisBottom(x)
  .ticks(6)
  .tickFormat(d => formatNumber(Number(d)));

svg.append("g")
  .attr("transform", `translate(0,${height - margin.bottom})`)
  .call(xAxis)
  .selectAll("text")
  .attr("transform", "rotate(90)")
  .style("text-anchor", "START")
  .attr("dx", "0.5em")
  .attr("dy", "-0.5em");


  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .attr("class", "title")
    .text(title);

  svg.append("text")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height + 10)
    .attr("text-anchor", "middle")
    .attr("font-size", 12) 
    .text(
      selectedType === "artist"
        ? "Track Popularity"
        : "Artist Followers"
    );

  svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(margin.top + height - margin.bottom) / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .text(
      selectedType === "artist"
        ? "Track Name"
        : "Artist Name"
    );

}, [artistData, selectedNode, selectedType]);

// ==========================
// VIEW 3
// ==========================

useEffect(() => {
if (!artistData.length || !view3Ref.current) return;


  const svg = d3.select(view3Ref.current);
  svg.selectAll("*").remove();

  const width = 1000;
  const height = 400;
  const margin = { top: 80, right: 40, bottom: 60, left: 40 };

  svg.attr("viewBox", `0 0 ${width} ${height}`);


  const baselineY = height - 100;

  const topArtists = d3.rollups(
    artistData,
    v => d3.mean(v, d => d.artist_followers)!,
    d => d.artist_name
  )
    .sort((a, b) => d3.descending(a[1], b[1]))
    .slice(0, 10)
    .map(d => d[0]);

  const parseGenres = (g: string) => {
    if (!g) return [];
    return g
      .replace(/[\[\]']/g, "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  };

  const artistGenreMap = new Map<string, Set<string>>();

  topArtists.forEach(artist => {
    const rows = artistData.filter(d => d.artist_name === artist);
    const set = new Set<string>();

    rows.forEach(d => {
      parseGenres(d.artist_genres).forEach(g => set.add(g));
    });

    artistGenreMap.set(artist, set);
  });

  const links: { source: string; target: string }[] = [];

  artistGenreMap.forEach((genres, artist) => {
    genres.forEach(g => {
      links.push({ source: artist, target: g });
    });
  });

  const genres = Array.from(
    new Set(links.map(d => d.target))
  );

  const nodes = [...topArtists, ...genres];

  const x = d3.scalePoint()
    .domain(nodes)
    .range([margin.left, width - margin.right]);

const linkSelection = svg.append("g")
  .selectAll("path")
  .data(links)
  .enter()
  .append("path")
  .attr("fill", "none")
  .attr("stroke", "#999")
  .attr("stroke-opacity", 0.3)
  .attr("stroke-width", 1.5)

  .attr("class", "arc-link");


  const buildArc = (source: string, target: string) => {
  const x1 = x(source)!;
  const x2 = x(target)!;
  const r = Math.abs(x2 - x1) / 2;

  const sweep = x1 < x2 ? 1 : 0;

  return `
    M ${x1} ${baselineY}
    A ${r} ${r} 0 0 ${sweep} ${x2} ${baselineY}
  `;
};

const animateLink = (path: any) => {
  const totalLength = path.node().getTotalLength();

  path
    .attr("stroke-dasharray", totalLength)
    .attr("stroke-dashoffset", totalLength)
    .transition()
    .duration(800)
    .ease(d3.easeCubicOut)
    .attr("stroke-dashoffset", 0);
};

const nodeSelection = svg.append("g")
  .selectAll("circle")
  .data(nodes)
  .enter()
  .append("circle")
  .attr("cx", d => x(d)!)
  .attr("cy", baselineY)
  .attr("r", d =>
    topArtists.includes(d) ? 12 : 6
  )
  .attr("fill", d =>
    topArtists.includes(d) ? "#6baed6" : "#bdbdbd"
  )
  .attr("class", "arc-node")
  .style("cursor", "pointer");

const labelSelection = svg.append("g")
  .selectAll("text")
  .data(nodes)
  .enter()
  .append("text")
  .attr("x", d => x(d)!)
  .attr("y", baselineY + 30)
  .attr("transform", d => 
    `rotate(-90, ${x(d)!}, ${baselineY + 30})`
  )
  .attr("text-anchor", "end")  
  .attr("font-size", 12)
  .attr("class", "arc-label")
  .style("cursor", "pointer")
  .text(d => d);

let activeNode: string | null = null;

const highlight = (name: string) => {
  activeNode = name;

  linkSelection.each(function (d) {
    const path = d3.select(this);

    if (d.source === name || d.target === name) {

      let arcPath;

      if (topArtists.includes(name)) {
    // clicked artist → Artist → Genre
    arcPath = buildArc(d.source, d.target);
  } else {
    arcPath = buildArc(d.target, d.source);
  }


      path
        .attr("d", arcPath)
        .attr("stroke", "#2171b5")
        .attr("stroke-width", 3)
        .attr("stroke-opacity", 1);

      const totalLength = (path.node() as SVGPathElement).getTotalLength();

      path
        .attr("stroke-dasharray", totalLength)
        .attr("stroke-dashoffset", totalLength)
        .transition()
        .duration(900)
        .ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0);

    } else {
      path
        .attr("stroke", "#ddd")
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.1)
        .attr("stroke-dasharray", null)
        .attr("stroke-dashoffset", null);
    }
  });

  nodeSelection
    .attr("fill", d =>
      d === name ? "#2171b5" : "#ccc"
    )
    .attr("r", d =>
      d === name ? 16 : (topArtists.includes(d) ? 12 : 6)
    );

  labelSelection
    .attr("font-weight", d =>
      d === name ? "bold" : "normal"
    );
};

linkSelection.attr("d", d => buildArc(d.source, d.target));


const reset = () => {
  activeNode = null;

  linkSelection
    .attr("stroke", "#999")
    .attr("stroke-width", 1.5)
    .attr("stroke-opacity", 0.4);

  nodeSelection
    .attr("fill", d =>
      topArtists.includes(d) ? "#6baed6" : "#bdbdbd"
    )
    .attr("r", d =>
      topArtists.includes(d) ? 12 : 6
    );

  labelSelection
    .attr("font-weight", "normal");
};

nodeSelection.on("click", (_, d) => {
  if (activeNode === d) {
    reset();
    setSelectedNode(null);
    setSelectedType(null);
  } else {
    highlight(d);
    setSelectedNode(d);
    setSelectedType(
      topArtists.includes(d) ? "artist" : "genre"
    );
  }
});

labelSelection.on("click", (_, d) => {
  if (activeNode === d) {
    reset();
    setSelectedNode(null);
    setSelectedType(null);
  } else {
    highlight(d);
    setSelectedNode(d);
    setSelectedType(
      topArtists.includes(d) ? "artist" : "genre"
    );
  }
});

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", -30)
    .attr("text-anchor", "middle")
    .attr("class", "title")
    .text("Top 10 Artists and Their Genre Connections");

}, [artistData]);




return (
  <div id="main-container">

    {/* TOP ROW: MULTIVARIATE + FOCUS */}
    <div id="top-row">
      <div className="chart-container">
        <svg ref={view3Ref} />
      </div>

      <div className="chart-container">
        <svg ref={view2Ref} />
      </div>
    </div>

   <div id="overview-row">
  <div className="chart-container overview-container">
    <svg ref={view1Ref} />

    {maxBinCount > 0 && (
      <div className="legend legend-inside">
        <strong>Song Density</strong><br />
        <span style={{ color: d3.interpolateBlues(0.1) }}>■</span>Low count<br />
        <span style={{ color: d3.interpolateBlues(0.5) }}>■</span>Medium count<br />
        <span style={{ color: d3.interpolateBlues(1) }}>■</span>High count<br />
      </div>
    )}
  </div>
</div>




  </div>
);
}
